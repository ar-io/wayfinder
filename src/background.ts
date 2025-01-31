import {
  IO,
  IO_TESTNET_PROCESS_ID,
  WalletAddress,
  AoGateway,
  AoGatewayWithAddress,
} from "@ar.io/sdk/web";

export type OnlineGateway = AoGatewayWithAddress & {
  online?: boolean;
};

// Global variables
let redirectedTabs: Record<number, boolean> = {}; // A dictionary to keep track of redirected tabs
const RANDOM_ROUTE_METHOD = "random";
const STAKE_RANDOM_ROUTE_METHOD = "stakeRandom";
const HIGHEST_STAKE_ROUTE_METHOD = "highestStake";
const RANDOM_TOP_FIVE_STAKED_ROUTE_METHOD = "topFiveStake";
const WEIGHTED_ONCHAIN_PERFORMANCE_ROUTE_METHOD = "weightedOnchainPerformance";
const MAX_HISTORY_ITEMS = 20;
const LIVENESS_CHECK = 25;

const defaultGateway: AoGatewayWithAddress = {
  operatorStake: 250000000000,
  settings: {
    allowedDelegates: [],
    allowDelegatedStaking: true,
    autoStake: false,
    delegateRewardShareRatio: 5,
    fqdn: "arweave.net",
    label: "Arweave.net",
    minDelegatedStake: 100000000,
    note: "Arweave ecosystem gateway.",
    port: 443,
    properties: "",
    protocol: "https",
  },
  stats: {
    failedConsecutiveEpochs: 0,
    passedEpochCount: 114,
    passedConsecutiveEpochs: 0,
    totalEpochCount: 0,
    failedEpochCount: 0,
    observedEpochCount: 0,
    prescribedEpochCount: 0,
  },
  status: "joined",
  totalDelegatedStake: 0,
  weights: {
    stakeWeight: 0,
    tenureWeight: 0,
    gatewayRewardRatioWeight: 0,
    normalizedCompositeWeight: 0,
    observerRewardRatioWeight: 0,
    compositeWeight: 0,
  },
  startTimestamp: 0,
  endTimestamp: 0,
  observerAddress: "",
  services: {
    bundlers: [],
  },
  gatewayAddress: "DEFAULT",
};

// Set default values in Chrome storage
chrome.storage.local.set({
  routingMethod: RANDOM_TOP_FIVE_STAKED_ROUTE_METHOD,
});
chrome.storage.local.set({ garCache: {} });
chrome.storage.local.set({ enrichedGar: {} });
chrome.storage.local.set({ blacklistedGateways: [] });
chrome.storage.local.set({ processId: IO_TESTNET_PROCESS_ID });

console.log("Initialized AR.IO");
let arIO = IO.init();

// Run the check initially when the background script starts
getGatewayAddressRegistry(arIO);

// Finds requests for ar:// in the browser address bar
chrome.webNavigation.onBeforeNavigate.addListener(
  async (details) => {
    const url = new URL(details.url);
    const arUrl = url.searchParams.get("q");

    if (arUrl && arUrl.startsWith("ar://")) {
      const startTime = performance.now(); // Start timing

      const {
        url: redirectTo,
        gatewayFQDN,
        gatewayAddress,
      } = await getRoutableGatewayUrl(arUrl);

      if (redirectTo) {
        chrome.tabs.update(details.tabId, { url: redirectTo }, async () => {
          const responseTime = performance.now() - startTime; // Measure redirection time

          // Ensure `gatewayPerformance` exists before adding data
          let data = await chrome.storage.local.get(["gatewayPerformance"]);
          let gatewayPerformance = data.gatewayPerformance || {}; // Initialize if empty

          if (!gatewayPerformance[gatewayFQDN]) {
            gatewayPerformance[gatewayFQDN] = {
              responseTimes: [],
              failures: 0,
              successCount: 0,
              lastUpdated: Date.now(),
            };
          }

          // Store response time and update success count
          gatewayPerformance[gatewayFQDN].responseTimes.push(responseTime);
          gatewayPerformance[gatewayFQDN].successCount += 1;

          // Keep only the last 50 response times
          if (gatewayPerformance[gatewayFQDN].responseTimes.length > 50) {
            gatewayPerformance[gatewayFQDN].responseTimes.shift();
          }

          // Save updated performance data
          await chrome.storage.local.set({ gatewayPerformance });

          // Log output AFTER storing data
          chrome.storage.local.get(["gatewayPerformance"], (updatedData) => {
            console.log(
              "Updated Gateway Performance Data:",
              updatedData.gatewayPerformance
            );
          });
        });
      }
    }
  },
  { url: [{ schemes: ["http", "https"] }] }
);

chrome.webRequest.onErrorOccurred.addListener(
  async (details) => {
    const url = new URL(details.url);
    const gatewayFQDN = url.hostname;

    // Fetch locally stored gateways
    let data = await chrome.storage.local.get(["garCache"]);
    let garCache = data.garCache || {};

    // Check if the failed request matches any known gateway
    const isKnownGateway = Object.values(garCache).some(
      (gateway: any) => gateway.settings.fqdn === gatewayFQDN
    );

    if (!isKnownGateway) return; // Ignore requests that don't match stored gateways

    console.warn(`❌ Gateway Request Failed: ${gatewayFQDN}`);

    // Fetch existing performance data
    let perfData = await chrome.storage.local.get(["gatewayPerformance"]);
    let gatewayPerformance = perfData.gatewayPerformance || {};

    if (!gatewayPerformance[gatewayFQDN]) {
      gatewayPerformance[gatewayFQDN] = {
        responseTimes: [],
        failures: 0,
        successCount: 0,
      };
    }

    // Increment failure count
    gatewayPerformance[gatewayFQDN].failures += 1;

    console.log("🚨 Updated Failure Count:", gatewayPerformance[gatewayFQDN]);

    // Save updated failure data
    await chrome.storage.local.set({ gatewayPerformance });
  },
  { urls: ["<all_urls>"] }
);

// Store request start times
const requestTimings = new Map<string, number>();

// Capture request start time
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    requestTimings.set(details.requestId, details.timeStamp); // Store request start time
  },
  { urls: ["<all_urls>"] }
);

// Tracks performance metrics after redirecting to an AR.IO gateway
chrome.webRequest.onCompleted.addListener(
  async (details) => {
    const url = new URL(details.url);
    const gatewayFQDN = url.hostname;

    // Only track AR.IO and Arweave.net gateways, not other web requests
    let data = await chrome.storage.local.get(["garCache"]);
    let garCache = data.garCache || {};

    const isKnownGateway = Object.values(garCache).some(
      (gateway: any) => gateway.settings.fqdn === gatewayFQDN
    );

    if (!isKnownGateway) return; // Ignore requests that don't match stored gateways

    // Retrieve the request start time
    const startTime = requestTimings.get(details.requestId);
    if (!startTime) return; // If no start time was recorded, skip

    const responseTime = details.timeStamp - startTime; // Compute actual response time
    requestTimings.delete(details.requestId); // Clean up after measuring

    console.log(
      `✅ Gateway Request Completed: ${gatewayFQDN} in ${responseTime.toFixed(2)}ms`
    );

    // Ensure `gatewayPerformance` exists before adding data
    let perfData = await chrome.storage.local.get(["gatewayPerformance"]);
    let gatewayPerformance = perfData.gatewayPerformance || {}; // Initialize if empty

    if (!gatewayPerformance[gatewayFQDN]) {
      gatewayPerformance[gatewayFQDN] = {
        responseTimes: [],
        failures: 0,
        successCount: 0,
        lastUpdated: Date.now(),
      };
    }

    // Store response time and update success count
    gatewayPerformance[gatewayFQDN].responseTimes.push(responseTime);
    gatewayPerformance[gatewayFQDN].successCount += 1;

    // Keep only the last 50 response times
    if (gatewayPerformance[gatewayFQDN].responseTimes.length > 50) {
      gatewayPerformance[gatewayFQDN].responseTimes.shift();
    }

    // Save updated performance data
    await chrome.storage.local.set({ gatewayPerformance });

    // Log updated performance data
    chrome.storage.local.get(["gatewayPerformance"], (updatedData) => {
      console.log(
        "📊 Updated Gateway Performance Data:",
        updatedData.gatewayPerformance
      );
    });
  },
  { urls: ["<all_urls>"] }
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
  ["responseHeaders"]
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.message === "setArIOProcessId") {
    reinitalizeArIO()
      .then(() => getGatewayAddressRegistry(arIO))
      .then(() => sendResponse({}))
      .catch((error) => {
        console.error(error);
        sendResponse({
          error:
            "Failed to reinitialize AR.IO and sync gateway address registry.",
        });
      });

    return true; // this keeps the message channel open until `sendResponse` is invoked
  }
});

// Used if someone clicks on an ar:// link in a page
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.type === "arUrlClicked") {
    const arUrl = message.arUrl;
    const { url } = await getRoutableGatewayUrl(arUrl);
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

//
// Helper functions

/**
 * Refresh the online status of all gateways in the cache.
 * @returns A promise that resolves to the updated cache.
 */
export async function refreshAllGateways(): Promise<
  Record<string, OnlineGateway>
> {
  const { garCache } = await chrome.storage.local.get(["garCache"]);
  const promises = Object.entries(garCache).map(async ([address, gateway]) => {
    const online = await isGatewayOnline(gateway as AoGateway);
    const onlineGateway: OnlineGateway = {
      ...(gateway as AoGatewayWithAddress),
      online,
    };
    return { address, gateway: onlineGateway };
  });

  const results = await Promise.allSettled(promises);
  results.forEach((result) => {
    if (result.status === "fulfilled") {
      garCache[result.value.address] = result.value.gateway;
    }
  });

  return garCache;
}

/**
 * Refresh the online status of the top 25 staked gateways.
 * @returns A promise that resolves to the updated cache.
 */
async function refreshOnlineGateways(): Promise<Record<string, OnlineGateway>> {
  const { garCache } = await chrome.storage.local.get(["garCache"]);

  // Sort gateways by total stake (operatorStake + totalDelegatedStake)
  const sortedGateways = Object.entries(garCache)
    .map(([address, gateway]) => ({
      address,
      gateway: gateway as AoGateway,
      totalStake:
        (gateway as AoGateway).operatorStake +
        (gateway as AoGateway).totalDelegatedStake,
    }))
    .sort((a, b) => b.totalStake - a.totalStake) // Sort in descending order
    .slice(0, LIVENESS_CHECK); // Get the top 25 gateways

  // Only ping the top 25 gateways
  const promises = sortedGateways.map(async ({ address, gateway }) => {
    const online = await isGatewayOnline(gateway);
    return { address, gateway: { ...gateway, online } };
  });

  const results = await Promise.allSettled(promises);

  // Update cache with new online statuses
  results.forEach((result) => {
    if (result.status === "fulfilled") {
      garCache[result.value.address] = result.value.gateway;
    } else {
      console.warn(`Failed to refresh online status for ${result.reason}`);
    }
  });

  return garCache;
}

/**
 * Check if a gateway is online by sending a HEAD request.
 * @param gateway The gateway object to check.
 * @returns A promise that resolves to true if the gateway is online, otherwise false.
 */
async function isGatewayOnline(gateway: AoGateway): Promise<boolean> {
  const url = `${gateway.settings.protocol}://${gateway.settings.fqdn}:${gateway.settings.port}/`;
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Request for ${url} timed out after 5 seconds`)),
      5000
    )
  );

  try {
    const response = await Promise.race([
      fetch(url, { method: "HEAD", mode: "no-cors" }),
      timeoutPromise,
    ]);
    return (response as Response).ok;
  } catch (error) {
    console.error(error);
    return false;
  }
}

/**
 * Synchronize the gateway address registry with the cache.
 */
async function getGatewayAddressRegistry(arIO: any): Promise<void> {
  try {
    const { processId } = await chrome.storage.local.get(["processId"]);
    console.log(
      "Getting the gateways with the SDK and Process Id: ",
      processId
    );

    const garCache = await fetchAllGateways();
    await chrome.storage.local.set({ garCache });
    console.log(
      `Found ${
        Object.keys(garCache).length
      } gateways cached. Syncing availability...`
    );
    const enrichedGar = await refreshOnlineGateways();
    await chrome.storage.local.set({ enrichedGar });
    console.log(
      `Finished syncing gateway availability. Found ${
        Object.values(enrichedGar).filter((g) => g.online).length
      } gateways online.`
    );
  } catch (error) {
    console.error(
      "An error occurred while syncing the Gateway Address Registry:",
      (error as Error).message
    );
  }
}

/**
 * Fetch all gateways from the AR.IO SDK.
 */
const fetchAllGateways = async (): Promise<
  Record<WalletAddress, AoGateway>
> => {
  const gateways: Record<WalletAddress, AoGateway> = {};
  let cursor;
  do {
    const response = await arIO.getGateways({ cursor });
    for (const gateway of response.items) {
      const { gatewayAddress, ...gatewayData } = gateway;
      gateways[gatewayAddress] = gatewayData;
    }
    cursor = response.nextCursor;
  } while (cursor);
  return gateways;
};

/**
 * Get an online gateway based on the configured routing method.
 * @returns A promise that resolves to a gateway object.
 */
async function getOnlineGateway(): Promise<AoGatewayWithAddress> {
  const { staticGateway } = (await chrome.storage.local.get([
    "staticGateway",
  ])) as { staticGateway?: AoGatewayWithAddress };
  if (staticGateway) {
    console.log("Static gateway being used:", staticGateway.settings.fqdn);
    return staticGateway;
  }

  const { routingMethod } = (await chrome.storage.local.get([
    "routingMethod",
  ])) as { routingMethod: string };
  const { enrichedGar } = (await chrome.storage.local.get(["enrichedGar"])) as {
    enrichedGar: Record<string, OnlineGateway>;
  };
  const { blacklistedGateways = [] } = (await chrome.storage.local.get([
    "blacklistedGateways",
  ])) as { blacklistedGateways: string[] };

  const filteredGar: Record<string, OnlineGateway> = Object.fromEntries(
    Object.entries(enrichedGar).filter(
      ([address]) => !blacklistedGateways.includes(address)
    )
  );

  let gateway: AoGatewayWithAddress | null = null;
  console.log("ROUTING METHOD IS: ", routingMethod);
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
    case WEIGHTED_ONCHAIN_PERFORMANCE_ROUTE_METHOD:
      gateway = selectWeightedOnchainPerformanceGateway(filteredGar);
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
  timestamp: string
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
  gar: Record<string, OnlineGateway>
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
 * Select a weighted random gateway based on total stake (operator + delegated).
 * @param gar The GAR JSON object.
 * @returns A weighted random Gateway object or the default gateway if no gateways are online.
 */
function selectWeightedGateway(
  gar: Record<string, OnlineGateway>
): OnlineGateway {
  // Filter only online gateways
  const onlineGateways = Object.values(gar).filter((gateway) => gateway.online);

  // Compute total stake (operatorStake + totalDelegatedStake) for each gateway
  const getTotalStake = (gateway: OnlineGateway) =>
    gateway.operatorStake + gateway.totalDelegatedStake;

  // Compute the total combined stake of all online gateways
  const totalStake = onlineGateways.reduce(
    (accum, gateway) => accum + getTotalStake(gateway),
    0
  );

  // If no stake is present, return the default gateway
  if (totalStake === 0) {
    console.warn("No gateways with stake available. Using default.");
    return defaultGateway;
  }

  // Generate a random number between 0 and totalStake
  let randomNum = Math.random() * totalStake;

  // Iterate through gateways, subtracting their stake until we select one
  for (const gateway of onlineGateways) {
    randomNum -= getTotalStake(gateway);
    if (randomNum <= 0) {
      return gateway;
    }
  }

  // Fallback (should never happen unless there's a rounding error)
  console.warn("Unexpected failure in weighted selection. Using default.");
  return defaultGateway;
}

/**
 * Select the gateway with the highest stake.
 * @param gar The GAR JSON object.
 * @returns The gateway with the highest stake or the default gateway if no gateways are online.
 */
function selectHighestStakeGateway(
  gar: Record<string, OnlineGateway>
): OnlineGateway {
  // Compute the total stake for each gateway
  const getTotalStake = (gateway: OnlineGateway) =>
    gateway.operatorStake + gateway.totalDelegatedStake;

  // Find the maximum total stake
  const maxStake = Math.max(...Object.values(gar).map(getTotalStake));

  // Filter gateways with the max stake that are online
  const maxStakeGateways = Object.values(gar).filter(
    (gateway) => getTotalStake(gateway) === maxStake && gateway.online
  );

  // If no gateways are online, return a default
  if (maxStakeGateways.length === 0) {
    console.warn("No online gateways available. Using default.");
    return defaultGateway;
  }

  // If only one gateway has the highest stake, return it
  if (maxStakeGateways.length === 1) {
    return maxStakeGateways[0];
  }

  // If multiple gateways have the highest stake, pick one randomly
  return maxStakeGateways[Math.floor(Math.random() * maxStakeGateways.length)];
}

/**
 * Select a random gateway from the top five staked gateways.
 * @param gar The GAR JSON object.
 * @returns A random Gateway object from the top five staked gateways or the default gateway if no gateways are online.
 */
function selectRandomTopFiveStakedGateway(
  gar: Record<string, OnlineGateway>
): OnlineGateway {
  // Compute total stake for sorting
  const getTotalStake = (gateway: OnlineGateway) =>
    gateway.operatorStake + gateway.totalDelegatedStake;

  // Filter online gateways and sort them by total stake in descending order
  const sortedGateways = Object.values(gar)
    .filter((gateway) => gateway.online)
    .sort((a, b) => getTotalStake(b) - getTotalStake(a));

  // If no gateways are online, return the default gateway
  if (sortedGateways.length === 0) {
    console.warn("No online gateways available. Using default.");
    return defaultGateway;
  }

  // Select the top 5 highest staked gateways (or fewer if less than 5 exist)
  const top5 = sortedGateways.slice(0, Math.min(5, sortedGateways.length));

  // Randomly pick one of the top 5
  return top5[Math.floor(Math.random() * top5.length)];
}

/**
 * Selects a gateway using a weighted random selection based on stake, tenure, and performance metrics.
 *
 * This function assigns each gateway a composite weight derived from:
 * - **Stake Weight (SW):** Represents the financial commitment of the gateway.
 * - **Tenure Weight (TW):** Rewards gateways based on their duration in the network (max 4).
 * - **Gateway Performance Ratio Weight (GPRW):** Measures the success rate of resolving ArNS names.
 * - **Observer Performance Ratio Weight (OPRW):** Evaluates the accuracy of observation reports.
 *
 * The weighted selection ensures that high-staked, long-standing, and well-performing gateways
 * have a greater likelihood of being chosen while still maintaining randomness for fairness.
 *
 * @param gateways A record of available gateways indexed by their address.
 * @returns A weighted random Gateway object or the default gateway if no eligible gateways exist.
 */
function selectWeightedOnchainPerformanceGateway(
  gateways: Record<string, OnlineGateway>
): OnlineGateway {
  const alpha = 0.5; // Stake weight
  const beta = 0.15; // Tenure weight
  const gamma = 0.2; // Gateway performance weight
  const delta = 0.15; // Observer performance weight

  // Compute performance-based weight for each gateway
  const gatewayWeights = Object.entries(gateways)
    .map(([address, gateway]) => ({
      address,
      gateway,
      weight:
        alpha * gateway.weights.stakeWeight +
        beta * gateway.weights.tenureWeight +
        gamma * gateway.weights.gatewayRewardRatioWeight +
        delta * gateway.weights.observerRewardRatioWeight,
    }))
    .filter(({ gateway }) => gateway.status === "joined") // Only consider active gateways
    .filter(({ weight }) => weight > 0); // Exclude gateways with zero weight

  // Normalize weights to sum to 1
  const totalWeight = gatewayWeights.reduce((sum, gw) => sum + gw.weight, 0);
  if (totalWeight === 0) return defaultGateway; // Failover if no valid gateways

  // Weighted random selection
  let randomNum = Math.random() * totalWeight;
  for (const { gateway, weight } of gatewayWeights) {
    randomNum -= weight;
    if (randomNum <= 0) return gateway;
  }

  return defaultGateway; // Fallback
}

/**
 * Selects the best-performing gateway using both on-chain and off-chain metrics.
 *
 * This function assigns each gateway a composite weight derived from:
 * - **On-Chain Metrics:** Stake, tenure, and performance.
 * - **Off-Chain Metrics:** Response time, success rate, failure count.
 *
 * This ensures that users are routed to the fastest, highest-performing, and most reliable gateways.
 *
 * @param gateways A record of available gateways indexed by their address.
 * @returns A weighted random Gateway object or the default gateway if no eligible gateways exist.
 */
async function selectOptimalGateway(
  gateways: Record<string, OnlineGateway>
): Promise<OnlineGateway> {
  // Load off-chain performance data from storage
  const { gatewayPerformance } =
    await chrome.storage.local.get("gatewayPerformance");

  const weights = {
    stakeWeight: 0.4, // Stake priority
    tenureWeight: 0.1, // Long-term participation
    gprWeight: 0.15, // Gateway performance in resolving ArNS
    oprWeight: 0.1, // Observer accuracy
    rtWeight: 0.15, // Response time (off-chain)
    srWeight: 0.07, // Success rate (off-chain)
    fwWeight: -0.07, // Failure penalty (off-chain)
  };

  // Compute weighted score for each gateway
  const gatewayWeights = Object.entries(gateways)
    .map(([address, gateway]) => {
      const offchainMetrics = gatewayPerformance?.[gateway.settings.fqdn] || {
        responseTimes: [],
        failures: 0,
        successCount: 0,
      };

      // Calculate response time (average, default to 5000ms if no data)
      const avgResponseTime = offchainMetrics.responseTimes.length
        ? offchainMetrics.responseTimes.reduce((a: any, b: any) => a + b, 0) /
          offchainMetrics.responseTimes.length
        : 5000;

      // Normalize response time weight (lower is better)
      const responseTimeWeight = 1 / (1 + avgResponseTime / 1000); // Example normalization (0 to 1)

      // Calculate success rate (default to 100% if no data)
      const successRate =
        offchainMetrics.successCount > 0
          ? offchainMetrics.successCount /
            (offchainMetrics.successCount + offchainMetrics.failures)
          : 1;

      // Normalize failure impact (higher failures = lower weight)
      const failureImpact = -Math.min(1, offchainMetrics.failures / 10); // Example: Max penalty at 10 failures

      // Calculate final weighted score
      const weight =
        weights.stakeWeight * gateway.weights.stakeWeight +
        weights.tenureWeight * gateway.weights.tenureWeight +
        weights.gprWeight * gateway.weights.gatewayRewardRatioWeight +
        weights.oprWeight * gateway.weights.observerRewardRatioWeight +
        weights.rtWeight * responseTimeWeight +
        weights.srWeight * successRate +
        weights.fwWeight * failureImpact;

      return { address, gateway, weight };
    })
    .filter(({ gateway }) => gateway.status === "joined") // Only active gateways
    .filter(({ weight }) => weight > 0); // Exclude gateways with zero weight

  // If no valid gateways, return default
  const totalWeight = gatewayWeights.reduce((sum, gw) => sum + gw.weight, 0);
  if (totalWeight === 0) return defaultGateway;

  // Weighted random selection
  let randomNum = Math.random() * totalWeight;
  for (const { gateway, weight } of gatewayWeights) {
    randomNum -= weight;
    if (randomNum <= 0) return gateway;
  }

  return defaultGateway;
}

/**
 * Convert an ar:// URL to a routable gateway URL and return gateway metadata.
 * @param arUrl The ar:// URL to convert.
 * @returns A promise that resolves to an object containing the routable URL and gateway metadata.
 */
async function getRoutableGatewayUrl(arUrl: string): Promise<{
  url: string;
  gatewayFQDN: string;
  gatewayProtocol: string;
  gatewayPort: number | null;
  gatewayAddress: string;
  selectedGateway: OnlineGateway;
}> {
  const arUrlParts = arUrl.slice(5).split("/");
  const baseName = arUrlParts[0];
  const path = "/" + arUrlParts.slice(1).join("/");

  // Select the best-performing gateway
  const selectedGateway = await getOnlineGateway();

  // Extract gateway metadata
  const gatewayFQDN = selectedGateway.settings.fqdn;
  const gatewayProtocol = selectedGateway.settings.protocol;
  const gatewayPort = selectedGateway.settings.port || null;
  const gatewayAddress = selectedGateway.gatewayAddress; // Assuming gateway object has an `address` field

  let redirectTo: string | null = null;

  // Determine if it's a transaction ID or domain name
  if (/[a-z0-9_-]{43}/i.test(baseName)) {
    redirectTo = `${gatewayProtocol}://${gatewayFQDN}:${gatewayPort}/${baseName}${path}`;
  } else if (baseName.includes(".")) {
    const txId = await lookupArweaveTxIdForDomain(baseName);
    if (txId) {
      redirectTo = `${gatewayProtocol}://${gatewayFQDN}:${gatewayPort}/${txId}${path}`;
    }
  } else {
    redirectTo = `${gatewayProtocol}://${baseName}.${gatewayFQDN}${gatewayPort ? `:${gatewayPort}` : ""}${path}`;
  }

  return {
    url: redirectTo || "",
    gatewayFQDN,
    gatewayProtocol,
    gatewayPort,
    gatewayAddress,
    selectedGateway,
  };
}

/**
 * Lookup the Arweave transaction ID for a given domain using DNS TXT records.
 * @param domain The domain to lookup.
 * @returns A promise that resolves to the Arweave transaction ID or null if not found.
 */
async function lookupArweaveTxIdForDomain(
  domain: string
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
      (error as Error).message
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

async function reinitalizeArIO(): Promise<boolean> {
  try {
    const { processId } = await chrome.storage.local.get(["processId"]);
    arIO = IO.init({ processId });
    return true;
  } catch (err) {
    arIO = IO.init();
    console.log("Cannot reinitalize with new AR.IO Process ID.  Using default");
    console.log(err);
    return false;
  }
}
