let gar = {};
let sortedGar = {};
let redirectedTabs = {};  // A dictionary to keep track of redirected tabs
const RANDOM_ROUTE_METHOD = 'random';
const STAKE_RANDOM_ROUTE_METHOD = 'stakeRandom';
const HIGHEST_STAKE_ROUTE_METHOD = 'highestStake';
const RANDOM_TOP_FIVE_STAKED_ROUTE_METHOD = 'topFiveStake'
const MAX_HISTORY_ITEMS = 20;
const CONCURRENT_REQUESTS = 10; // number of gateways to check concurrently

const defaultTestGARCacheURL = "https://dev.arns.app/v1/contract/E-pRI1bokGWQBqHnbut9rsHSt9Ypbldos3bAtwg4JMc/gateways";
const defaultGARCacheURL = "https://dev.arns.app/v1/contract/bLAgYxAdX2Ry-nt6aH2ixgvJXbpsEYm28NgJgyqfs-U/gateways";
chrome.storage.local.set({routingMethod: RANDOM_TOP_FIVE_STAKED_ROUTE_METHOD }); // sets the default route method
chrome.storage.local.set({garCache: {}});
chrome.storage.local.set({garLocal: {}});
chrome.storage.local.set({blacklistedGateways: []});

// Run the check initially when the background script starts
syncGatewayAddressRegistry();

// Finds requests for ar:// in the browser address bar
chrome.webNavigation.onBeforeNavigate.addListener(async function(details) {
  const url = new URL(details.url);
  const arUrl = url.searchParams.get("q")
  if (arUrl && arUrl.includes("ar://")) {
      const name = arUrl.replace("ar://", "");
      const gateway = await getOnlineGateway();
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
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if(request.message === "syncGatewayAddressRegistry") {
      syncGatewayAddressRegistry().then(() => {
          // send a response after async operation is done
          sendResponse({});
      }).catch(error => {
          // handle error if you need to send error info to popup.js
          console.error(error);
          sendResponse({error: "Failed to sync gateway address registry."});
      });
      
      return true; // this keeps the message channel open until `sendResponse` is invoked
  }
});

// Used if someone clicks on an ar:// link in a page
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.type === 'arUrlClicked') {
    const arUrl = message.arUrl;
    const url = await getRoutableGatewayUrl(arUrl)
    if (message.target === "_blank") {
        // Open in a new tab
        const tab = await chrome.tabs.create({url}); 
        redirectedTabs[tab.id] = true;
    } else {
        // Open in the current tab
        const tab = await chrome.tabs.update(sender.tab.id, {url});
        redirectedTabs[tab.id] = true;
    }
    return true;
  }
});

// Used if someone requests an ar:// image on a page
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.type === 'arImageUrlRequested') {
    const arUrl = message.arUrl;
    const url = await getRoutableGatewayUrl(arUrl)
    console.log ("ooo got an image!")
    fetch(url)
        .then(response => response.blob())
        .then(blob => {
            const imageUrl = URL.createObjectURL(blob);
            sendResponse({ imageUrl });
        })
        .catch(error => {
            console.error(`Error fetching AR content from ${url}:`, error);
            sendResponse({ error: 'Failed to fetch AR content' });
        });
    
    // This will keep the message channel open to the sender until `sendResponse` is executed
    return true;
  }
});

async function isGatewayOnline(gateway) {
  const url = `${gateway.settings.protocol}://${gateway.settings.fqdn}:${gateway.settings.port}/`;

  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error(`Request for ${url} timed out after 5 seconds`)), 5 * 1000) // 5 seconds
  );

  try {
    const response = await Promise.race([
      fetch(url, { 
        method: 'HEAD', 
        mode: 'no-cors'
      }),
      timeoutPromise
    ]);
    return response.ok;
  } catch (error) {
    console.log(error.message);  // Log the error
    return false;
  }
}

async function refreshOnlineGateways() {
  const { garCache } = await chrome.storage.local.get(["garCache"]);
  const promises = [];
  
  for (const address in garCache) {
    promises.push((async () => {
      const gateway = garCache[address];
      gateway.online = await isGatewayOnline(gateway);
      return { address, gateway };
    })());
  }

  const results = await Promise.allSettled(promises);
  
  results.forEach(result => {
    if (result.status === 'fulfilled') {
      garCache[result.value.address] = result.value.gateway;
    }
  });

  return garCache;
}

async function fetchGatewayAddressRegistryCache(garCacheURL) {
  return fetch(garCacheURL)
    .then(response => response.json())
    .then(data => (data.gateways ?? data.state.gateways));
}

async function syncGatewayAddressRegistry() {
  try {
      const { garCacheURL } = await chrome.storage.local.get(["garCacheURL"]);
      let garCache = {};

      if (garCacheURL) {
          console.log("Fetching User-defined GAR Cache from ", garCacheURL);
          garCache = await fetchGatewayAddressRegistryCache(garCacheURL);
      } else {
          console.log("Fetching Default GAR Cache from ", defaultGARCacheURL);
          garCache = await fetchGatewayAddressRegistryCache(defaultGARCacheURL);
      }

      console.log ()
      await chrome.storage.local.set({garCache: garCache});
      console.log("Found %s gateways cached. Syncing availability...", Object.keys(garCache).length);
      
      const garLocal = await refreshOnlineGateways();
      await chrome.storage.local.set({garLocal: garLocal});
      console.log("Finished syncing gateway availability. Found %s gateways online.", (Object.values(garLocal).filter(gateway => gateway.online)).length);
  
  } catch (error) {
      console.error("An error occurred while syncing the Gateway Address Registry:", error.message);
  }
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
  const { blacklistedGateways = {} } = await chrome.storage.local.get(["blacklistedGateways"]);

  const filteredGar = {};
  for (const [address, gatewayData] of Object.entries(garLocal)) {
    if (!blacklistedGateways.includes(address)) {
        filteredGar[address] = gatewayData;
    }
  }

  let gateway = {}
  if (routingMethod === RANDOM_TOP_FIVE_STAKED_ROUTE_METHOD) {
    gateway = selectRandomTopFiveStakedGateway(filteredGar);
    console.log ("Random Top 5 staked gateway being used: ", gateway.settings.fqdn);
    return gateway;
  }
  else if (routingMethod === STAKE_RANDOM_ROUTE_METHOD) {
    gateway = selectWeightedGateway(filteredGar);
    console.log ("Stake-weighted random gateway being used: ", gateway.settings.fqdn)
    return gateway;
  } else if (routingMethod === RANDOM_ROUTE_METHOD) {
    gateway = selectRandomGateway(filteredGar);
    console.log ("Random gateway being used: ", gateway.settings.fqdn)
    return gateway;
  } else if (routingMethod === HIGHEST_STAKE_ROUTE_METHOD) {
    gateway = selectHighestStakeGateway(filteredGar);
    console.log ("Highest staked gateway being used: ", gateway.settings.fqdn)
    return gateway;
  }
  
  if (!gateway) {
    console.error('There is no valid gateway to use.', gateway);
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

function selectRandomTopFiveStakedGateway(gar) {
  // 1. Sort the gateways based on their stake in descending order and filter online gateways
  const sortedGateways = Object.values(gar)
      .filter(gateway => gateway.online)
      .sort((gatewayA, gatewayB) => gatewayB.operatorStake - gatewayA.operatorStake);
  
  // If there's no online gateway, handle this case
  if (sortedGateways.length === 0) {
    console.error('No online gateways available.');
    return null;
  }

  // 2. Take the top 5 or as many as are available (in cases where there are less than 5 online gateways)
  const top5 = sortedGateways.slice(0, Math.min(5, sortedGateways.length));
  
  // 3. Randomly select one from the top 5
  const randomIndex = Math.floor(Math.random() * top5.length);
  return top5[randomIndex];
}

// This method takes an ar:// URL and converts it to a routable URL
// Uses an online gateway frmo the GAR, using the configured routing settings
async function getRoutableGatewayUrl(arUrl) {
  const name = arUrl.replace("ar://", "");
  const gateway = await getOnlineGateway();
  let redirectTo;
  if (!/[a-z0-9_-]{43}/i.test(name)) { // this is an ArNS name
    redirectTo = `${gateway.settings.protocol}://${name}.${gateway.settings.fqdn}:${gateway.settings.port}/`;
  } else { // this is an arweave transaction ID
    redirectTo = `${gateway.settings.protocol}://${gateway.settings.fqdn}:${gateway.settings.port}/${name}`;
  }
  return redirectTo;
}
