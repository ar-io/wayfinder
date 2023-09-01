const GATEWAY_DOMAINS = ["ar-io.dev", "g8way.io", "arweave.dev", "vilenarios.com", "gatewaypie.com", "ideployedtoosoonhowdoidelete.website", "not-real.xyz", "fakeway.io"]; // Replace this with the stake weighted GAR
let gar = {};
let sortedGar = {};
let onlineGateways = [];
let redirectedTabs = {};  // A dictionary to keep track of redirected tabs
let notificationData = {}; // Data to pass around for notifications
const MAX_HISTORY_ITEMS = 20;

const defaultGARCacheURL = "https://dev.arns.app/v1/contract/E-pRI1bokGWQBqHnbut9rsHSt9Ypbldos3bAtwg4JMc/gateways";

chrome.storage.local.set({gateways: GATEWAY_DOMAINS});

// Run the check initially when the background script starts
// syncGatewayAddressRegistry();
syncGatewayAddressRegistry();

// Finds requests for ar:// in the browser address bar
chrome.webNavigation.onBeforeNavigate.addListener(async function(details) {
  const url = new URL(details.url);
  const arUrl = url.searchParams.get("q")
  if (arUrl && arUrl.includes("ar://")) {
      const name = arUrl.replace("ar://", "");
      const gateway = await getRandomOnlineGateway();
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

// Provides the gateway list for display in the popup
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.type === "getGateways") {
      sendResponse({gateways: GATEWAY_DOMAINS});
  }
});

// Returns a list of the online gateways.
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
      if(request.message === "getOnlineGateways") {
          sendResponse({onlineGateways: onlineGateways});
      }
  }
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
  console.log ("Fetching GAR Cache from ", defaultGARCacheURL)
  const garCache = await fetchGatewayAddressRegistryCache(defaultGARCacheURL)
  await chrome.storage.local.set({garCache: garCache});
  console.log (garCache)
  console.log ("Found %s gateways cached.  Syncing availability...", Object.keys(garCache).length)
  const garLocal = await refreshOnlineGateways();
  await chrome.storage.local.set({garLocal: garLocal});
  console.log (garLocal)
  console.log ("Finished syncing")
}

// Get a random online gateway or use the one selected via settings.
async function getRandomOnlineGateway() {
  const { staticGateway } = await chrome.storage.local.get(["staticGateway"]);
  if (staticGateway) {
    console.log ("Static gateway being used: ", staticGateway)
    return staticGateway
  }

  const { garLocal } = await chrome.storage.local.get(["garLocal"]);
  const gateway = selectRandomGateway(garLocal);

  // const gateway = onlineGateways[Math.floor(Math.random() * onlineGateways.length)];
  if (!gateway) {
    console.error('Selected gateway is not valid:', gateway);
    return null;  // Or return a default gateway or handle this situation as appropriate
  } else {
    console.log ("Dynamic gateway being used: ", gateway)
    return gateway;
  }
}

function getStaticGateway() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get("staticGateway", function(data) {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError));
      }
      resolve(data.staticGateway || null);
    });
  });
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
    console.error('No online gateways available.');
    return null;
  }

  // Select a random online gateway
  const randomIndex = Math.floor(Math.random() * onlineGateways.length);
  return onlineGateways[randomIndex];
}