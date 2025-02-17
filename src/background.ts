import {
  WalletAddress,
  AoGateway,
  ARIO_TESTNET_PROCESS_ID,
  ARIO,
  AOProcess,
} from "@ar.io/sdk/web";
import { getRoutableGatewayUrl } from "./routing";
import {
  backgroundGatewayBenchmarking,
  isKnownGateway,
  saveToHistory,
  updateGatewayPerformance,
} from "./helpers";
import { DEFAULT_AO_CU_URL, OPTIMAL_GATEWAY_ROUTE_METHOD } from "./constants";
import { RedirectedTabInfo } from "./types";
import { connect } from "@permaweb/aoconnect";

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
  aoCuUrl: DEFAULT_AO_CU_URL,
});

// Ensure we sync the registry before running benchmarking
async function initializeWayfinder() {
  console.log("🔄 Initializing Wayfinder...");
  await syncGatewayAddressRegistry(); // **Wait for GAR sync to complete**
  await backgroundGatewayBenchmarking(); // **Benchmark after GAR is ready**
}

initializeWayfinder().catch((err) =>
  console.error("🚨 Error during Wayfinder initialization:", err)
);

/**
 * Handles browser navigation for `ar://` links.
 */
chrome.webNavigation.onBeforeNavigate.addListener(
  (details) => {
    setTimeout(async () => {
      try {
        const url = new URL(details.url);
        const arUrl = url.searchParams.get("q");

        if (!arUrl || !arUrl.startsWith("ar://")) return;

        const { url: redirectTo, gatewayFQDN } =
          await getRoutableGatewayUrl(arUrl);

        if (redirectTo) {
          const startTime = performance.now();
          chrome.tabs.update(details.tabId, { url: redirectTo }, async () => {
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
    }, 0); // 🔥 Defer execution to avoid blocking listener thread
  },
  { url: [{ schemes: ["http", "https"] }] }
);

/**
 * Tracks request start time.
 */
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    requestTimings.set(details.requestId, performance.now());
  },
  { urls: ["<all_urls>"] }
);

/**
 * Tracks successful gateway requests for performance metrics.
 */
chrome.webRequest.onCompleted.addListener(
  async (details) => {
    const gatewayFQDN = new URL(details.url).hostname;
    if (!(await isKnownGateway(gatewayFQDN))) return; // ✅ Ensure it's a real AR.IO gateway

    const startTime = requestTimings.get(details.requestId);
    if (!startTime) return;

    requestTimings.delete(details.requestId);

    // const responseTime = details.timeStamp - startTime;
    // console.log(
    // `✅ Gateway Request Completed: ${gatewayFQDN} in ${responseTime.toFixed(2)}ms`
    // );

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

    if (tabInfo) {
      for (const header of details.responseHeaders || []) {
        if (header.name.toLowerCase() === "x-arns-resolved-id") {
          const timestamp = new Date().toISOString();
          saveToHistory(details.url, header.value || "undefined", timestamp);
          break;
        }
      }

      // 🔥 Always remove tracking for this tab, regardless of headers
      delete redirectedTabs[details.tabId];
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

/**
 * Handles failed gateway requests.
 */
chrome.webRequest.onErrorOccurred.addListener(
  async (details) => {
    const gatewayFQDN = new URL(details.url).hostname;
    if (!(await isKnownGateway(gatewayFQDN))) return; // ✅ Ensure it's a real AR.IO gateway

    console.warn(`❌ Gateway Request Failed: ${gatewayFQDN}`);

    let { gatewayPerformance = {} } = await chrome.storage.local.get([
      "gatewayPerformance",
    ]);

    if (!gatewayPerformance[gatewayFQDN]) {
      gatewayPerformance[gatewayFQDN] = {
        responseTimes: [],
        failures: 0,
        successCount: 0,
      };
    }

    gatewayPerformance[gatewayFQDN].failures += 1;

    await chrome.storage.local.set({ gatewayPerformance });
  },
  { urls: ["<all_urls>"] }
);

/**
 * Periodically cleans up requestTimings to prevent memory leaks.
 */
setInterval(() => {
  const now = performance.now();
  for (const [requestId, timestamp] of requestTimings.entries()) {
    if (now - timestamp > 60000) {
      requestTimings.delete(requestId); // Remove old requests older than 1 min
    }
  }
}, 30000); // Runs every 30 seconds

/**
 * Handles messages from content scripts for syncing gateway data.
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || typeof request !== "object" || !request.message) return;
  if (
    ![
      "syncGatewayAddressRegistry",
      "setArIOProcessId",
      "setAoCuUrl",
      "convertArUrlToHttpUrl",
    ].includes(request.message)
  ) {
    console.warn("⚠️ Unauthorized message:", request);
    return;
  }

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
        console.error(
          "❌ Failed to set new Process ID and reinitialize AR.IO:",
          error
        );
        sendResponse({
          error: "Failed to set new Process ID and reinitialize AR.IO.",
        });
      });
    return true;
  }
  if (request.message === "setAoCuUrl") {
    reinitializeArIO()
      .then(() => syncGatewayAddressRegistry())
      .then(() => sendResponse({}))
      .catch((error) => {
        console.error(
          "❌ Failed to set new AO CU Url and reinitialize AR.IO:",
          error
        );
        sendResponse({
          error: "Failed to set new AO CU Url and reinitialize AR.IO.",
        });
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
    const { processId, aoCuUrl } = await chrome.storage.local.get([
      "processId",
      "aoCuUrl",
    ]);

    if (!processId) {
      throw new Error("❌ Process ID missing in local storage.");
    }

    if (!aoCuUrl) {
      throw new Error("❌ AO CU Url missing in local storage.");
    }

    console.log(
      `🔄 Fetching Gateway Adress Registry from ${aoCuUrl} with Process ID: ${processId}`
    );

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
    const { processId, aoCuUrl } = await chrome.storage.local.get([
      "processId",
      "aoCuUrl",
    ]);
    arIO = ARIO.init({
      process: new AOProcess({
        processId: processId,
        ao: connect({ MODE: "legacy", CU_URL: aoCuUrl }),
      }),
    });
    console.log("🔄 AR.IO reinitialized with Process ID:", processId);
  } catch (error) {
    arIO = ARIO.init();
    console.error("❌ Failed to reinitialize AR.IO. Using default.");
  }
}
