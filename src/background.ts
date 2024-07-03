import { IO, Gateway } from "@ar.io/sdk/web";

if (typeof self !== 'undefined') {
  // Define 'window' as 'self' to simulate the window object
  self.window = self;
}


export type OnlineGateway = Gateway & {
  online?: boolean;
};

// Global variables
let redirectedTabs: Record<number, boolean> = {}; // A dictionary to keep track of redirected tabs
const RANDOM_ROUTE_METHOD = "random";
const STAKE_RANDOM_ROUTE_METHOD = "stakeRandom";
const HIGHEST_STAKE_ROUTE_METHOD = "highestStake";
const RANDOM_TOP_FIVE_STAKED_ROUTE_METHOD = "topFiveStake";
const MAX_HISTORY_ITEMS = 20;

const defaultGateway: Gateway = {
  delegates: {},
  end: 0,
  observerWallet: "IPdwa3Mb_9pDD8c2IaJx6aad51Ss-_TfStVwBuhtXMs",
  operatorStake: 250000000000,
  settings: {
    allowDelegatedStaking: true,
    autoStake: false,
    delegateRewardShareRatio: 30,
    fqdn: "ar-io.dev",
    label: "AR.IO Test",
    minDelegatedStake: 100000000,
    note: "Test Gateway operated by PDS for the AR.IO ecosystem.",
    port: 443,
    properties: "raJgvbFU-YAnku-WsupIdbTsqqGLQiYpGzoqk9SCVgY",
    protocol: "https",
  },
  start: 1256694,
  stats: {
    failedConsecutiveEpochs: 0,
    passedEpochCount: 114,
    submittedEpochCount: 113,
    totalEpochParticipationCount: 120,
    totalEpochsPrescribedCount: 120,
  },
  status: "joined",
  totalDelegatedStake: 13868917608,
  vaults: {},
  weights: {
    stakeWeight: 0,
    tenureWeight: 0,
    gatewayRewardRatioWeight: 0,
    normalizedCompositeWeight: 0,
    observerRewardRatioWeight: 0,
    compositeWeight: 0,
  },
};

// Set default values in Chrome storage
chrome.storage.local.set({
  routingMethod: RANDOM_TOP_FIVE_STAKED_ROUTE_METHOD,
});
chrome.storage.local.set({ garCache: {} });
chrome.storage.local.set({ enrichedGarCache: {} });
chrome.storage.local.set({ blacklistedGateways: [] });

console.log("Initialized AR.IO");
const arIO = IO.init();

// Run the check initially when the background script starts
getGatewayAddressRegistry(arIO);
console.log("Got the registry");

// Finds requests for ar:// in the browser address bar
chrome.webNavigation.onBeforeNavigate.addListener(
  async (details) => {
    const url = new URL(details.url);
    const arUrl = url.searchParams.get("q");
    if (arUrl && arUrl.startsWith("ar://")) {
      const redirectTo = await getRoutableGatewayUrl(arUrl);
      if (redirectTo) {
        chrome.tabs.update(details.tabId, { url: redirectTo });
      }
    }
  },
  { url: [{ schemes: ["http", "https"] }] },
);

// To handle getting the X-Arns-Resolved-Id
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (redirectedTabs[details.tabId]) {
      const timestamp = new Date().toISOString(); // Current timestamp
      const url = new URL(details.url);
      for (const header of details.responseHeaders || []) {
        if (header.name.toLowerCase() === "x-arns-resolved-id") {
          const headerValue = header.value || "undefined";
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
  { urls: ["<all_urls>"] },
  ["responseHeaders"],
);

// Used if someone clicks the refresh gateways button
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.message === "syncGatewayAddressRegistry") {
    getGatewayAddressRegistry(arIO)
      .then(() => sendResponse({}))
      .catch((error) => {
        console.error(error);
        sendResponse({ error: "Failed to sync gateway address registry." });
      });

    return true; // this keeps the message channel open until `sendResponse` is invoked
  }
});

// Used if someone clicks on an ar:// link in a page
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.type === "arUrlClicked") {
    const arUrl = message.arUrl;
    const url = await getRoutableGatewayUrl(arUrl);
    if (message.target === "_blank") {
      const tab = await chrome.tabs.create({ url });
      if (tab.id !== undefined) {
        redirectedTabs[tab.id] = true;
      }
    } else {
      if (sender.tab?.id !== undefined) {
        const tab = await chrome.tabs.update(sender.tab.id, { url });
        redirectedTabs[sender.tab.id] = true;
      }
    }
    return true;
  }
});

// Used if someone requests an ar:// image on a page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "convertArUrlToHttpUrl") {
    const arUrl = message.arUrl;
    getRoutableGatewayUrl(arUrl)
      .then((url) => {
        if (!url) throw new Error("URL is undefined");
        sendResponse({ url });
      })
      .catch((error) => {
        console.error("Error in message listener:", error);
        sendResponse({ error: error.message });
      });

    return true; // indicate that the response will be sent asynchronously
  }
});
// Helper functions

/**
 * Check if a gateway is online by sending a HEAD request.
 * @param gateway The gateway object to check.
 * @returns A promise that resolves to true if the gateway is online, otherwise false.
 */
async function isGatewayOnline(gateway: Gateway): Promise<boolean> {
  const url = `${gateway.settings.protocol}://${gateway.settings.fqdn}:${gateway.settings.port}/`;
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Request for ${url} timed out after 5 seconds`)),
      5000,
    ),
  );

  try {
    const response = await Promise.race([
      fetch(url, { method: "HEAD", mode: "no-cors" }),
      timeoutPromise,
    ]);
    return (response as Response).ok;
  } catch (error) {
    console.log((error as Error).message); // Log the error
    return false;
  }
}

/**
 * Refresh the online status of all gateways in the cache.
 * @returns A promise that resolves to the updated cache.
 */
async function refreshOnlineGateways(): Promise<Record<string, OnlineGateway>> {
  const { garCache } = await chrome.storage.local.get(["garCache"]);
  const promises = Object.entries(garCache).map(async ([address, gateway]) => {
    const online = await isGatewayOnline(gateway as Gateway);
    const onlineGateway: OnlineGateway = { ...gateway as Gateway, online };
    return { address, gateway: onlineGateway };
  });

  const results = await Promise.allSettled(promises);
  console.log(results)
  results.forEach((result) => {
    if (result.status === "fulfilled") {
      garCache[result.value.address] = result.value.gateway;
    }
  });

  return garCache;
}

/**
 * Synchronize the gateway address registry with the cache.
 */
async function getGatewayAddressRegistry(arIO: any): Promise<void> {
  try {
    console.log("Getting the gateways with the SDK");
    const garCache = await arIO.getGateways();
    await chrome.storage.local.set({ garCache });
    console.log(
      `Found ${
        Object.keys(garCache).length
      } gateways cached. Syncing availability...`,
    );
    const enrichedGarCache = await refreshOnlineGateways();
    await chrome.storage.local.set({ enrichedGarCache });
    console.log(
      `Finished syncing gateway availability. Found ${
        Object.values(enrichedGarCache).filter((g) => g.online).length
      } gateways online.`,
    );
  } catch (error) {
    console.error(
      "An error occurred while syncing the Gateway Address Registry:",
      (error as Error).message,
    );
  }
}

/**
 * Get an online gateway based on the configured routing method.
 * @returns A promise that resolves to a gateway object.
 */
async function getOnlineGateway(): Promise<Gateway> {
  const { staticGateway } = (await chrome.storage.local.get([
    "staticGateway",
  ])) as { staticGateway?: Gateway };
  if (staticGateway) {
    console.log("Static gateway being used:", staticGateway.settings.fqdn);
    return staticGateway;
  }

  const { routingMethod } = (await chrome.storage.local.get([
    "routingMethod",
  ])) as { routingMethod: string };
  const { enrichedGarCache } = (await chrome.storage.local.get([
    "enrichedGarCache",
  ])) as {
    enrichedGarCache: Record<string, OnlineGateway>;
  };
  const { blacklistedGateways = [] } = (await chrome.storage.local.get([
    "blacklistedGateways",
  ])) as { blacklistedGateways: string[] };

  const filteredGar: Record<string, OnlineGateway> = Object.fromEntries(
    Object.entries(enrichedGarCache).filter(
      ([address]) => !blacklistedGateways.includes(address),
    ),
  );

  let gateway: Gateway | null = null;
  switch (routingMethod) {
    case RANDOM_TOP_FIVE_STAKED_ROUTE_METHOD:
      gateway = selectRandomTopFiveStakedGateway(filteredGar);
      break;
    case STAKE_RANDOM_ROUTE_METHOD:
      gateway = selectWeightedGateway(filteredGar);
      break;
    case RANDOM_ROUTE_METHOD:
      gateway = selectRandomGateway(filteredGar);
      break;
    case HIGHEST_STAKE_ROUTE_METHOD:
      gateway = selectHighestStakeGateway(filteredGar);
      break;
  }

  if (!gateway) {
    console.error("There is no valid gateway to use.");
    return defaultGateway;
  }

  return gateway;
}

/**
 * Save a history entry to local storage.
 * @param url The URL accessed.
 * @param resolvedId The resolved Arweave transaction ID.
 * @param timestamp The timestamp of the access.
 */
function saveToHistory(
  url: string,
  resolvedId: string,
  timestamp: string,
): void {
  chrome.storage.local.get("history", (data) => {
    let history = data.history || [];
    history.unshift({ url, resolvedId, timestamp }); // Adds to the start
    history = history.slice(0, MAX_HISTORY_ITEMS); // Keep only the last MAX_HISTORY_ITEMS items
    chrome.storage.local.set({ history });
  });
}

/**
 * Select a random gateway from the GAR JSON.
 * @param gar The GAR JSON object.
 * @returns A random Gateway object or the default gateway if no gateways are online.
 */
function selectRandomGateway(
  gar: Record<string, OnlineGateway>,
): OnlineGateway {
  const onlineGateways = Object.values(gar).filter((gateway) => gateway.online);
  if (onlineGateways.length === 0) {
    console.log("No online random gateways available. Using default");
    return defaultGateway;
  }
  const randomIndex = Math.floor(Math.random() * onlineGateways.length);
  return onlineGateways[randomIndex];
}

/**
 * Select a weighted random gateway based on operator stake.
 * @param gar The GAR JSON object.
 * @returns A weighted random Gateway object or the default gateway if no gateways are online.
 */
function selectWeightedGateway(
  gar: Record<string, OnlineGateway>,
): OnlineGateway {
  const onlineGateways = Object.values(gar).filter((gateway) => gateway.online);
  const totalStake = onlineGateways.reduce(
    (accum, gateway) => accum + gateway.operatorStake,
    0,
  );
  let randomNum = Math.random() * totalStake;
  for (const gateway of onlineGateways) {
    randomNum -= gateway.operatorStake;
    if (randomNum <= 0) {
      return gateway;
    }
  }
  console.log("No gateways available. Using default.");
  return defaultGateway;
}

/**
 * Select the gateway with the highest stake.
 * @param gar The GAR JSON object.
 * @returns The gateway with the highest stake or the default gateway if no gateways are online.
 */
function selectHighestStakeGateway(
  gar: Record<string, OnlineGateway>,
): OnlineGateway {
  const maxStake = Math.max(
    ...Object.values(gar).map((gateway) => gateway.operatorStake),
  );
  const maxStakeGateways = Object.values(gar).filter(
    (gateway) => gateway.operatorStake === maxStake && gateway.online,
  );
  if (maxStakeGateways.length === 0) {
    console.log("No online gateways available. Using default.");
    return defaultGateway;
  }
  if (maxStakeGateways.length === 1) {
    return maxStakeGateways[0];
  }
  const randomIndex = Math.floor(Math.random() * maxStakeGateways.length);
  return maxStakeGateways[randomIndex];
}

/**
 * Select a random gateway from the top five staked gateways.
 * @param gar The GAR JSON object.
 * @returns A random Gateway object from the top five staked gateways or the default gateway if no gateways are online.
 */
function selectRandomTopFiveStakedGateway(
  gar: Record<string, OnlineGateway>,
): OnlineGateway {
  const sortedGateways = Object.values(gar)
    .filter((gateway) => gateway.online)
    .sort((a, b) => b.operatorStake - a.operatorStake);
  if (sortedGateways.length === 0) {
    console.log("No online gateways available. Using default.");
    return defaultGateway;
  }
  const top5 = sortedGateways.slice(0, Math.min(5, sortedGateways.length));
  const randomIndex = Math.floor(Math.random() * top5.length);
  return top5[randomIndex];
}

/**
 * Convert an ar:// URL to a routable gateway URL.
 * @param arUrl The ar:// URL to convert.
 * @returns A promise that resolves to the routable gateway URL.
 */
async function getRoutableGatewayUrl(arUrl: string): Promise<string> {
  const arUrlParts = arUrl.slice(5).split("/");
  const baseName = arUrlParts[0];
  const path = "/" + arUrlParts.slice(1).join("/");
  const gateway = await getOnlineGateway();
  let redirectTo: string | null = null;

  if (/[a-z0-9_-]{43}/i.test(baseName)) {
    redirectTo = `${gateway.settings.protocol}://${gateway.settings.fqdn}:${gateway.settings.port}/${baseName}${path}`;
  } else if (baseName.includes(".")) {
    const txId = await lookupArweaveTxIdForDomain(baseName);
    if (txId) {
      redirectTo = `${gateway.settings.protocol}://${gateway.settings.fqdn}:${gateway.settings.port}/${txId}${path}`;
    }
  } else {
    redirectTo = `${gateway.settings.protocol}://${baseName}.${
      gateway.settings.fqdn
    }${gateway.settings.port ? `:${gateway.settings.port}` : ""}${path}`;
  }
  return redirectTo || "";
}

/**
 * Lookup the Arweave transaction ID for a given domain using DNS TXT records.
 * @param domain The domain to lookup.
 * @returns A promise that resolves to the Arweave transaction ID or null if not found.
 */
async function lookupArweaveTxIdForDomain(
  domain: string,
): Promise<string | null> {
  const apiUrl = `https://dns.google/resolve?name=${domain}&type=TXT`;
  try {
    const response = await fetch(apiUrl);
    const data = await response.json();
    if (data.Answer) {
      for (const record of data.Answer) {
        const txtRecord = record.data;
        const match = txtRecord.match(/ARTX ([a-zA-Z0-9_-]{43})/);
        if (match) {
          return match[1];
        }
      }
    }
  } catch (error) {
    console.error(
      "Failed to lookup DNS TXT records:",
      (error as Error).message,
    );
    const response = await fetch(apiUrl);
    const data = await response.json();
    if (data.Answer) {
      for (const record of data.Answer) {
        const txtRecord = record.data;
        const match = txtRecord.match(/ARTX ([a-zA-Z0-9_-]{43})/);
        if (match) {
          return match[1];
        }
      }
    }
  }
  return null;
}
