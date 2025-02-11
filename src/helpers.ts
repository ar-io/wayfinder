import { AoGatewayWithAddress } from "@ar.io/sdk";
import { getGarForRouting, selectTopOnChainGateways } from "./routing";

const MAX_HISTORY_ITEMS = 20; // How many items are stored in wayfinder history

export async function backgroundGatewayBenchmarking() {
  console.log("📡 Running scheduled gateway benchmark...");

  const gar = await getGarForRouting();
  const topGateways = selectTopOnChainGateways(gar); // Get **top 25**

  if (topGateways.length === 0) {
    console.warn("⚠️ No top-performing gateways available.");
    return;
  }

  const pingResults = await Promise.all(
    topGateways.map(async (gateway: AoGatewayWithAddress) => {
      const fqdn = gateway.settings.fqdn;
      const start = performance.now();
      try {
        await fetch(`https://${fqdn}`, { method: "HEAD", mode: "no-cors" });
        return { fqdn, responseTime: performance.now() - start };
      } catch {
        return { fqdn, responseTime: Infinity }; // Mark failed ones as Infinity
      }
    })
  );

  const fastest = pingResults
    .filter((g) => g.responseTime !== Infinity) // Remove failed gateways
    .sort((a, b) => a.responseTime - b.responseTime)[0];

  if (fastest && fastest.responseTime < 2000) {
    console.log(
      `✅ Cached Fastest Gateway: ${fastest.fqdn} (${fastest.responseTime}ms)`
    );
    await chrome.storage.local.set({ cachedFastestGateway: fastest.fqdn });
  } else {
    console.warn("⚠️ No fast gateways found in benchmark.");
  }
}

/**
 * Saves a history entry.
 */
export function saveToHistory(
  url: string,
  resolvedId: string,
  timestamp: string
) {
  chrome.storage.local.get("history", (data) => {
    let history = data.history || [];
    history.unshift({ url, resolvedId, timestamp });
    history = history.slice(0, MAX_HISTORY_ITEMS);
    chrome.storage.local.set({ history });
  });
}
