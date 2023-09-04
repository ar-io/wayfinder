let gar = {};
let sortedGar = {};
let redirectedTabs = {};  // A dictionary to keep track of redirected tabs
const RANDOM_ROUTE_METHOD = 'random';
const STAKE_RANDOM_ROUTE_METHOD = 'stakeRandom';
const HIGHEST_STAKE_ROUTE_METHOD = 'highestStake';
const MAX_HISTORY_ITEMS = 20;

const defaultGARCacheURL = "https://dev.arns.app/v1/contract/E-pRI1bokGWQBqHnbut9rsHSt9Ypbldos3bAtwg4JMc/gateways";
chrome.storage.local.set({routingMethod: STAKE_RANDOM_ROUTE_METHOD }); // sets the default route method

// Run the check initially when the background script starts
syncGatewayAddressRegistry();

// Finds requests for ar:// in the browser address bar
chrome.webNavigation.onBeforeNavigate.addListener(async function(details) {
  const url = new URL(details.url);
  const arUrl = url.searchParams.get("q")
  if (arUrl && arUrl.includes("ar://")) {
      const name = arUrl.replace("ar://", "");
      const gateway = await getOnlineGateway();
      console.log (gateway)
      if (!/[a-z0-9_-]{43}/i.test(name)) {
        const redirectTo = `${gateway.settings.protocol}://${name}.${gateway.settings.fqdn}:${gateway.settings.port}/`;
        redirectedTabs[details.tabId] = true;
        chrome.tabs.update(details.tabId, {url: redirectTo});
      } else {
        const redirectTo = `${gateway.settings.protocol}://${gateway.settings.fqdn}:${gateway.settings.port}/${name}`;
        chrome.tabs.update(details.tabId, {url: redirectTo});
      }
  }
}, {urls: ["<all_urls>"]});

// To handle getting the X-Arns-Resolved-Id
chrome.webRequest.onHeadersReceived.addListener(
  function(details) {
      if (redirectedTabs[details.tabId]) {  // Check if this tab was redirected due to ar://
        const timestamp = new Date().toISOString(); // Current timestamp
        // Get ArNS Name
        const url = new URL(details.url); 
          for (let i = 0; i < details.responseHeaders.length; i++) {
              if (details.responseHeaders[i].name.toLowerCase() === "x-arns-resolved-id") {
                  let headerValue = details.responseHeaders[i].value;
                  console.log("X-Arns-Resolved-Id:", headerValue);
                  // Save to history
                  saveToHistory(url.origin, headerValue, timestamp);

                  // Cleanup: Remove the tabId from redirectedTabs as we've captured the header
                  delete redirectedTabs[details.tabId];
                  break;
              }
          }
      }
  },
  {
      urls: ["<all_urls>"]
  },
  ["responseHeaders"]
);

// Used if someone clicks the refresh gateways button
chrome.runtime.onMessage.addListener(async function(request, sender, sendResponse) {
  if(request.message === "syncGatewayAddressRegistry") {
    await syncGatewayAddressRegistry()
     // TO DO: send a correct response
    sendResponse({});
  }
});

async function isGatewayOnline(gateway) {
  // Construct the gateway URL
  const url = `${gateway.settings.protocol}://${gateway.settings.fqdn}:${gateway.settings.port}/`;
  
  try {
    // Make a request to the gateway. A simple HEAD request might suffice.
    const response = await fetch(url, { 
      method: 'HEAD', 
      mode: 'no-cors' // For cross-origin requests 
    });
    
    // If the request succeeds without any exceptions, the gateway is online.
    return response.ok;
  } catch (error) {
    // If any exceptions occur, assume the gateway is offline.
    return false;
  }
}

async function refreshOnlineGateways() {
  const { garCache } = await chrome.storage.local.get(["garCache"]);
  // Iterate through each gateway in the GAR
  for (const address in garCache) {
    const gateway = garCache[address];
    
    // Check if the current gateway is online
    const online = await isGatewayOnline(gateway);
    
    // Update the 'online' property of the gateway
    garCache[address].online = online;
  }
  return garCache
}

async function fetchGatewayAddressRegistryCache(garCacheURL = defaultGARCacheURL) {
  return fetch(garCacheURL)
    .then(response => response.json())
    .then(data => data.gateways);
}

async function syncGatewayAddressRegistry() {
  const { garCacheUrl } = await chrome.storage.local.get(["garCacheUrl"]);
  let garCache = {}
  if (garCacheUrl) {
    console.log ("Fetching User-defined GAR Cache from ", garCacheUrl)
    garCache = await fetchGatewayAddressRegistryCache(defaultGARCacheURL)
  } else {
    console.log ("Fetching Default GAR Cache from ", defaultGARCacheURL)
    garCache = await fetchGatewayAddressRegistryCache(defaultGARCacheURL)
  }

  await chrome.storage.local.set({garCache: garCache});
  console.log ("Found %s gateways cached.  Syncing availability...", Object.keys(garCache).length)
  const garLocal = await refreshOnlineGateways();
  await chrome.storage.local.set({garLocal: garLocal});
  console.log ("Finished syncing gateway availability.")
}

// Get a random online gateway or use the one selected via settings.
async function getOnlineGateway() {
  const { staticGateway } = await chrome.storage.local.get(["staticGateway"]);
  if (staticGateway) {
    console.log ("Static gateway being used: ", staticGateway)
    return staticGateway
  }

  const { routingMethod } = await chrome.storage.local.get(["routingMethod"]);
  const { garLocal } = await chrome.storage.local.get(["garLocal"]);
  let gateway = {}
  if (routingMethod === STAKE_RANDOM_ROUTE_METHOD) {
    gateway = selectWeightedGateway(garLocal);
    console.log ("Stake-weighted random gateway being used: ", gateway.settings.fqdn)
    return gateway;
  } else if (routingMethod === RANDOM_ROUTE_METHOD) {
    gateway = selectRandomGateway(garLocal);
    console.log ("Random gateway being used: ", gateway.settings.fqdn)
    return gateway;
  } else if (routingMethod === HIGHEST_STAKE_ROUTE_METHOD) {
    gateway = selectHighestStakeGateway(garLocal);
    console.log ("Highest staked gateway being used: ", gateway.settings.fqdn)
    return gateway;
  }
  
  if (!gateway) {
    console.error('Selected gateway is not valid:', gateway);
    return null;  // Or return a default gateway or handle this situation as appropriate
  }
}

function saveToHistory(url, resolvedId, timestamp) {
  chrome.storage.local.get("history", function(data) {
      let history = data.history || [];
      history.unshift({ url, resolvedId: resolvedId, timestamp }); // Adds to the start
      history = history.slice(0, MAX_HISTORY_ITEMS); // Keep only the last amount of items
      chrome.storage.local.set({ history });
  });
}

/**
 * Selects a random gateway from the GAR JSON.
 * 
 * @param {Object} gar- The GAR JSON object.
 * @returns {Gateway | null} - A random Gateway object or null if there are no gateways.
 */
function selectRandomGateway(gar) {
  // Filter out gateways that are offline
  const onlineGateways = Object.values(gar).filter(gateway => gateway.online);

  // If there are no online gateways, handle this case appropriately
  if (onlineGateways.length === 0) {
    console.error('No online random gateways available.');
    return null;
  }

  // Select a random online gateway
  const randomIndex = Math.floor(Math.random() * onlineGateways.length);
  return onlineGateways[randomIndex];
}

function selectWeightedGateway(gar) {
  const onlineGateways = Object.values(gar).filter(gateway => gateway.online);
  
  // Calculate the total stake among online gateways
  const totalStake = onlineGateways.reduce((accum, gateway) => accum + gateway.operatorStake, 0);

  // Generate a random number between 0 and totalStake
  let randomNum = Math.random() * totalStake;

  // Find the gateway that this random number falls into
  for (const gateway of onlineGateways) {
    randomNum -= gateway.operatorStake;
    if (randomNum <= 0) {
      return gateway;  // This is the selected gateway based on its weight
    }
  }

  // This point should never be reached if there's at least one online gateway, but just in case:
  console.error('No online gateways available.');
  return null;
}

function selectHighestStakeGateway(gar) {
  // Get the maximum stake value
  const maxStake = Math.max(...Object.values(gar).map(gateway => gateway.operatorStake));

  // Filter out all the gateways with this maximum stake value
  const maxStakeGateways = Object.values(gar)
                                 .filter(gateway => gateway.operatorStake === maxStake && gateway.online);

  // If there's no online gateway with the maximum stake, handle this case
  if (maxStakeGateways.length === 0) {
    console.error('No online gateways available with the highest stake.');
    return null;
  }

  // If there's only one online gateway with the maximum stake, return it
  if (maxStakeGateways.length === 1) {
    return maxStakeGateways[0];
  }

  // If there are multiple online gateways with the same highest stake, pick a random one and return it
  const randomIndex = Math.floor(Math.random() * maxStakeGateways.length);
  return maxStakeGateways[randomIndex];
}