import {
  WalletAddress,
  AoGateway,
  ARIO_TESTNET_PROCESS_ID,
  ARIO,
} from "@ar.io/sdk/web";
import { getRoutableGatewayUrl, OPTIMAL_GATEWAY_ROUTE_METHOD } from "./routing";
import { backgroundGatewayBenchmarking, saveToHistory } from "./helpers";

type RedirectedTabInfo = {
  originalGateway: string; // The original gateway FQDN (e.g., "permagate.io")
  expectedSandboxRedirect: boolean; // Whether we expect a sandbox redirect
  sandboxRedirectUrl?: string; // The final redirected URL (if applicable)
  startTime: number; // Timestamp of when the request started
};

// Global variables
let redirectedTabs: Record<number, RedirectedTabInfo> = {};
const requestTimings = new Map<string, number>();

console.log("🚀 Initializing AR.IO...");
let arIO = ARIO.init();

// Set default values in Chrome storage
chrome.storage.local.set({
  routingMethod: OPTIMAL_GATEWAY_ROUTE_METHOD,
  localGatewayAddressRegistry: {},
  blacklistedGateways: [],
  processId: ARIO_TESTNET_PROCESS_ID,
});

// Ensure we sync the registry before running benchmarking
async function initializeWayfinder() {
  console.log("🔄 Syncing Gateway Address Registry...");
  await syncGatewayAddressRegistry(); // **Wait for GAR sync to complete**

  console.log("📡 Running Initial Benchmark...");
  await backgroundGatewayBenchmarking(); // **Benchmark after GAR is ready**
}

initializeWayfinder().catch((err) =>
  console.error("🚨 Error during Wayfinder initialization:", err)
);

/**
 * Handles browser navigation for `ar://` links.
 */
chrome.webNavigation.onBeforeNavigate.addListener(
  async (details) => {
    try {
      const url = new URL(details.url);
      const arUrl = url.searchParams.get("q");

      if (!arUrl || !arUrl.startsWith("ar://")) return;

      const startTime = performance.now();
      const { url: redirectTo, gatewayFQDN } =
        await getRoutableGatewayUrl(arUrl);

      if (redirectTo) {
        chrome.tabs.update(details.tabId, { url: redirectTo }, async () => {
          // Track performance
          updateGatewayPerformance(gatewayFQDN, startTime);
        });

        // Store redirect tracking information
        redirectedTabs[details.tabId] = {
          originalGateway: gatewayFQDN,
          expectedSandboxRedirect: /^[a-z0-9_-]{43}$/i.test(arUrl.slice(5)), // True if it's a TxId
          startTime,
        };
      }
    } catch (error) {
      console.error("❌ Error processing ar:// navigation:", error);
    }
  },
  { url: [{ schemes: ["http", "https"] }] }
);

/**
 * Handles failed gateway requests.
 */
chrome.webRequest.onErrorOccurred.addListener(
  async (details) => {
    const gatewayFQDN = new URL(details.url).hostname;
    if (!(await isKnownGateway(gatewayFQDN))) return;

    console.warn(`❌ Gateway Request Failed: ${gatewayFQDN}`);

    let { gatewayPerformance = {} } = await chrome.storage.local.get([
      "gatewayPerformance",
    ]);
    gatewayPerformance[gatewayFQDN] = gatewayPerformance[gatewayFQDN] || {
      failures: 0,
      successCount: 0,
    };

    // Increment failure count and store
    gatewayPerformance[gatewayFQDN].failures += 1;
    await chrome.storage.local.set({ gatewayPerformance });
  },
  { urls: ["<all_urls>"] }
);

/**
 * Tracks request start time.
 */
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    requestTimings.set(details.requestId, details.timeStamp);
  },
  { urls: ["<all_urls>"] }
);

/**
 * Tracks successful gateway requests for performance metrics.
 */
chrome.webRequest.onCompleted.addListener(
  async (details) => {
    const gatewayFQDN = new URL(details.url).hostname;
    if (!(await isKnownGateway(gatewayFQDN))) return;

    const startTime = requestTimings.get(details.requestId);
    if (!startTime) return;

    const responseTime = details.timeStamp - startTime;
    requestTimings.delete(details.requestId);

    console.log(
      `✅ Gateway Request Completed: ${gatewayFQDN} in ${responseTime.toFixed(2)}ms`
    );
    updateGatewayPerformance(gatewayFQDN, startTime);
  },
  { urls: ["<all_urls>"] }
);

/**
 * Tracks ArNS resolution responses.
 */
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const tabInfo = redirectedTabs[details.tabId];
    if (!tabInfo) return;

    for (const header of details.responseHeaders || []) {
      if (header.name.toLowerCase() === "x-arns-resolved-id") {
        const timestamp = new Date().toISOString();
        saveToHistory(details.url, header.value || "undefined", timestamp);
        delete redirectedTabs[details.tabId]; // Cleanup
        break;
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

/**
 * Handles messages from content scripts for syncing gateway data.
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.message === "syncGatewayAddressRegistry") {
    syncGatewayAddressRegistry()
      .then(() => sendResponse({}))
      .catch((error) => {
        console.error("❌ Failed to sync GAR:", error);
        sendResponse({ error: "Failed to sync gateway address registry." });
      });
    return true;
  }

  if (request.message === "setArIOProcessId") {
    reinitializeArIO()
      .then(() => syncGatewayAddressRegistry())
      .then(() => sendResponse({}))
      .catch((error) => {
        console.error("❌ Failed to reinitialize AR.IO:", error);
        sendResponse({ error: "Failed to reinitialize AR.IO." });
      });
    return true;
  }

  if (request.type === "convertArUrlToHttpUrl") {
    const arUrl = request.arUrl;
    getRoutableGatewayUrl(arUrl)
      .then((response) => {
        if (!response || !response.url) {
          throw new Error("URL resolution failed, response is invalid");
        }
        sendResponse({ url: response.url }); // ✅ Extract only the URL
      })
      .catch((error) => {
        console.error("Error in message listener:", error);
        sendResponse({ error: error.message });
      });

    return true; // Keeps the response channel open for async calls
  }
});

/**
 * Fetches and stores the AR.IO Gateway Address Registry.
 */
async function syncGatewayAddressRegistry(): Promise<void> {
  try {
    const { processId } = await chrome.storage.local.get(["processId"]);
    if (!processId) {
      throw new Error("❌ Process ID missing in local storage.");
    }

    console.log("🔄 Fetching gateways with Process ID:", processId);

    const registry: Record<WalletAddress, AoGateway> = {};
    let cursor: string | undefined = undefined;
    let totalFetched = 0;

    do {
      const response = await arIO.getGateways({ cursor });

      if (!response?.items || response.items.length === 0) {
        console.warn("⚠️ No gateways found in this batch.");
        break;
      }

      response.items.forEach(({ gatewayAddress, ...gatewayData }) => {
        registry[gatewayAddress] = gatewayData;
      });

      totalFetched += response.items.length;
      cursor = response.nextCursor;
    } while (cursor);

    if (totalFetched === 0) {
      console.warn("⚠️ No gateways found after full sync.");
    } else {
      await chrome.storage.local.set({ localGatewayAddressRegistry: registry });
      console.log(`✅ Synced ${totalFetched} gateways.`);
    }
  } catch (error) {
    console.error("❌ Error syncing Gateway Address Registry:", error);
  }
}

/**
 * Reinitializes AR.IO with updated process ID.
 */
async function reinitializeArIO(): Promise<void> {
  try {
    const { processId } = await chrome.storage.local.get(["processId"]);
    arIO = ARIO.init({ processId });
    console.log("🔄 AR.IO reinitialized with Process ID:", processId);
  } catch (error) {
    arIO = ARIO.init();
    console.error("❌ Failed to reinitialize AR.IO. Using default.");
  }
}

/**
 * Checks if a hostname belongs to a known AR.IO gateway.
 */
export async function isKnownGateway(fqdn: string): Promise<boolean> {
  const { localGatewayAddressRegistry = {} } = await chrome.storage.local.get([
    "localGatewayAddressRegistry",
  ]);
  return Object.values(localGatewayAddressRegistry).some(
    (gw: any) => gw.settings.fqdn === fqdn
  );
}

/**
 * Updates gateway performance metrics.
 */
export async function updateGatewayPerformance(
  gatewayFQDN: string,
  startTime: number
) {
  const responseTime = performance.now() - startTime;

  // Ensure gatewayPerformance is initialized properly
  const storage = await chrome.storage.local.get(["gatewayPerformance"]);
  let gatewayPerformance = storage.gatewayPerformance || {};

  // Ensure the specific gateway entry is initialized
  if (!gatewayPerformance[gatewayFQDN]) {
    gatewayPerformance[gatewayFQDN] = {
      responseTimes: [],
      failures: 0,
      successCount: 0,
    };
  }

  // Ensure responseTimes array is initialized
  if (!Array.isArray(gatewayPerformance[gatewayFQDN].responseTimes)) {
    gatewayPerformance[gatewayFQDN].responseTimes = [];
  }

  // Push new response time
  gatewayPerformance[gatewayFQDN].responseTimes.push(responseTime);
  gatewayPerformance[gatewayFQDN].successCount += 1;

  // Trim responseTimes to keep the last 50 entries
  if (gatewayPerformance[gatewayFQDN].responseTimes.length > 50) {
    gatewayPerformance[gatewayFQDN].responseTimes.shift();
  }

  await chrome.storage.local.set({ gatewayPerformance });
}
