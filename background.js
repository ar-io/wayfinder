const GATEWAY_DOMAINS = ["ar-io.dev", "g8way.io", "arweave.dev", "vilenarios.com", "gatewaypie.com", "ideployedtoosoonhowdoidelete.website", "not-real.xyz", "fakeway.io"]; // Replace this with the stake weighted GAR
let onlineGateways = [];
let redirectedTabs = {};  // A dictionary to keep track of redirected tabs
let notificationData = {}; // Data to pass around for notifications
const MAX_HISTORY_ITEMS = 20;

chrome.storage.local.set({gateways: GATEWAY_DOMAINS});

// Run the check initially when the background script starts
refreshOnlineGateways();

// Finds requests for ar:// in the browser address bar
chrome.webNavigation.onBeforeNavigate.addListener(async function(details) {
  const url = new URL(details.url);
  const arUrl = url.searchParams.get("q")
  if (arUrl && arUrl.includes("ar://")) {
      const name = arUrl.replace("ar://", "");
      // if it is not an Arweave ID, redirect to permapages
      const gatewayDomain = await getRandomOnlineGateway();

      if (!/[a-z0-9_-]{43}/i.test(name)) {
        const redirectTo = `https://${name}.${gatewayDomain}`;
        redirectedTabs[details.tabId] = true;
        chrome.tabs.update(details.tabId, {url: redirectTo});
      } else {
        const redirectTo = `https://${gatewayDomain}/${name}`;
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
  if(request.message === "refreshOnlineGateways") {
    await refreshOnlineGateways()
     // TO DO: send a correct response
    sendResponse({});
  }
});

// Check if a gateway is online
async function isGatewayOnline(gateway) {
  const url = "https://" + gateway;
  return fetch(url, {
      method: 'HEAD', // HEAD is lightweight and just checks the headers
      mode: 'no-cors' // For cross-origin requests
  })
  .then(response => {
      if (response.ok) return true;
      return false;
  })
  .catch(error => {
    console.log ("Error fetching ", gateway)
    console.log (error)
      return false; // If there's an error (e.g., timeout), consider it offline
  });
}

// Update the online gateways list
async function refreshOnlineGateways() {
  console.log ("Refreshing online gateways.")
  const promises = GATEWAY_DOMAINS.map(gateway => isGatewayOnline(gateway));
  const results = await Promise.all(promises);
  onlineGateways = GATEWAY_DOMAINS.filter((gateway, index) => results[index]);
  console.log ("Gateways refreshed.  Current online gateways: ", onlineGateways)
}

// Get a random online gateway or use the one selected via settings.
async function getRandomOnlineGateway() {
  const staticGateway = await getStaticGateway();
  if (!onlineGateways || !onlineGateways.length) {
    console.error('onlineGateways array is empty or not defined:', onlineGateways);
    await refreshOnlineGateways();
  }
  const selectedGateway = onlineGateways[Math.floor(Math.random() * onlineGateways.length)];
  if (!selectedGateway && !staticGateway) {
    console.error('Selected gateway is not valid:', selectedGateway);
    return null;  // Or return a default gateway or handle this situation as appropriate
  }

  if (staticGateway) {
    console.log ("Static gateway being used: ", staticGateway)
    return staticGateway
  } else {
    console.log ("Dynamic gateway being used: ", selectedGateway)
    return selectedGateway;
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

function trimToEightChars(str) {
  if (str && str.length > 8) {
    return str.substring(0, 8) + "...";
  } else {
    return str; // return the original string if its length is <= 5
  }
}