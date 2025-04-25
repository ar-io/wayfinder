import { WalletAddress, AoGateway, ARIO, AOProcess, Wayfinder, AoARIORead, RandomGatewayRouter, PriorityGatewayRouter, FixedGatewayRouter, WayfinderRouter, ARIOGatewaysProvider } from "@ar.io/sdk/web";
import {
  backgroundGatewayBenchmarking,
  isKnownGateway,
  saveToHistory,
  updateGatewayPerformance,
} from "./helpers";
import {
  ARIO_MAINNET_PROCESS_ID,
  DEFAULT_AO_CU_URL,
} from "./constants";
import { RedirectedTabInfo } from "./types";
import { connect } from "@permaweb/aoconnect";

// Global variables
let redirectedTabs: Record<number, RedirectedTabInfo> = {};
const requestTimings = new Map<string, number>();

console.log("🚀 Initializing AR.IO...");
let ario = ARIO.mainnet();
let gatewaysProvider = new ARIOGatewaysProvider({ ario });
let wayfinder = new Wayfinder({
  // @ts-ignore
  httpClient: fetch,
  router: new RandomGatewayRouter({ 
    gatewaysProvider
  })
})

export const getArio = () => ario;
export const getWayfinder = () => wayfinder;
export const getGatewaysProvider = () => gatewaysProvider;
// Set default values in Chrome storage
chrome.storage.local.set({
  routingStrategy: wayfinder.router.name,
  localGatewayAddressRegistry: {},
  blacklistedGateways: [],
  processId: ARIO_MAINNET_PROCESS_ID,
  aoCuUrl: DEFAULT_AO_CU_URL,
  ensResolutionEnabled: true,
});

// Ensure we sync the registry before running benchmarking
async function initializeWayfinder() {
  console.log("🔄 Initializing Wayfinder...");
  await syncGatewayAddressRegistry({
    ario,
  }); // **Wait for GAR sync to complete**
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

        const redirectTo = await getWayfinder().resolveUrl({
          originalUrl: arUrl,
        });

        if (redirectTo) {
          const startTime = performance.now();
          chrome.tabs.update(details.tabId, { url: redirectTo.toString() });

          // ✅ Track that this tab was redirected, but don't update performance yet
          redirectedTabs[details.tabId] = {
            originalGateway: redirectTo.hostname,
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

    // ✅ Ignore non-ar:// navigation
    if (!redirectedTabs[details.tabId]) return;

    // ✅ Only track requests if they originated from an `ar://` redirection
    if (!(await isKnownGateway(gatewayFQDN))) return;

    const startTime = redirectedTabs[details.tabId].startTime;
    if (!startTime) return;

    // ✅ Cleanup tracking after use
    delete redirectedTabs[details.tabId];

    // ✅ Update performance metrics
    await updateGatewayPerformance(gatewayFQDN, startTime);
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
/**
 * Handles failed gateway requests.
 */
chrome.webRequest.onErrorOccurred.addListener(
  async (details) => {
    // ✅ Ignore background benchmark failures to avoid double counting
    if (redirectedTabs[details.tabId]) return;

    const gatewayFQDN = new URL(details.url).hostname;
    if (!(await isKnownGateway(gatewayFQDN))) return;

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
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  if (
    !["syncGatewayAddressRegistry", "setArIOProcessId", "setAoCuUrl"].includes(
      request.message
    ) &&
    request.type !== "convertArUrlToHttpUrl"
  ) {
    console.warn("⚠️ Unauthorized message:", request);
    return;
  }

  if (request.message === "syncGatewayAddressRegistry") {
    syncGatewayAddressRegistry({
      ario,
    })
      .then(() => backgroundGatewayBenchmarking())
      .then(() => sendResponse({}))
      .catch((error) => {
        console.error("❌ Failed to sync GAR:", error);
        sendResponse({ error: "Failed to sync gateway address registry." });
      });

    return true; // ✅ Keeps connection open for async response
  }

  if (request.message === "setAoCuUrl") {
    reinitializeArIO()
      .then(() => syncGatewayAddressRegistry({
        ario,
      }))
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
    const redirectTo   = await getWayfinder().resolveUrl({ originalUrl: arUrl })    ;
    if (!redirectTo) {
      throw new Error("URL resolution failed, response is invalid");
    }
    sendResponse({ url: redirectTo.toString() }); // ✅ Extract only the URL
    return true; // Keeps the response channel open for async calls
  }
});

/**
 * Fetches and stores the AR.IO Gateway Address Registry.
 */
async function syncGatewayAddressRegistry({
  ario,
}: {
  ario: AoARIORead;
} ): Promise<void> {
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

    gatewaysProvider = new ARIOGatewaysProvider({ ario });
    await gatewaysProvider.getGateways();
  } catch (error) {
    console.error("❌ Error syncing Gateway Address Registry:", error);
  }
}


/**
 * Returns a WayfinderRouter based on the strategy string.
 */
function getRouterFromStrategy({ strategy }: { strategy: string }): WayfinderRouter {
  switch (strategy) {
    case RandomGatewayRouter.name:
      return new RandomGatewayRouter({ gatewaysProvider: new ARIOGatewaysProvider({ ario }) });
    case PriorityGatewayRouter.name:
      return new PriorityGatewayRouter({ gatewaysProvider: new ARIOGatewaysProvider({ ario }) });
    case FixedGatewayRouter.name:
      return new FixedGatewayRouter({ gateway: new URL('https://arweave.net') });
    default:
      throw new Error(`Unknown routing strategy: ${strategy}`);
  }
}

/**
 * Reinitializes AR.IO with updated process ID.
 */
async function reinitializeArIO(): Promise<void> {
  try {
    const { processId, aoCuUrl, routingStrategyString } = await chrome.storage.local.get([
      "processId",
      "aoCuUrl",
      "routingStrategy",
    ])
    ario = ARIO.init({
      process: new AOProcess({
        processId: processId,
        ao: connect({ MODE: "legacy", CU_URL: aoCuUrl }),
      }),
    });
    const newRouter = getRouterFromStrategy({ strategy: routingStrategyString });
    wayfinder = new Wayfinder({
      // @ts-ignore
      httpClient: fetch,
      router: newRouter,
    });
    console.log("🔄 AR.IO reinitialized with Process ID:", processId);
  } catch (error) {
    ario = ARIO.mainnet();
    wayfinder = new Wayfinder({
      // @ts-ignore
      httpClient: fetch,
      router: getRouterFromStrategy({ strategy: 'priority' }),
    });
    console.error("❌ Failed to reinitialize AR.IO. Using default.");
  }
  finally {
    await chrome.storage.local.set({
      routingStrategy: wayfinder.router.name,
    });
    // set the processId to the new processId
    await chrome.storage.local.set({
      processId: ario.process.processId,
    });
  }
}
