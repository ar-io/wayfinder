import { AoARIORead, AoGatewayWithAddress } from "@ar.io/sdk";
import { selectTopOnChainGateways } from "./routing";
import { TOP_ONCHAIN_GATEWAY_LIMIT, MAX_HISTORY_ITEMS } from "./constants";
import { getGatewaysProvider } from "./background";

export async function backgroundGatewayBenchmarking() {
  console.log(
    `📡 Running Gateway benchmark against top ${TOP_ONCHAIN_GATEWAY_LIMIT} gateways...`
  );

  const gar = await getGatewaysProvider().getGateways();
  const topGateways = selectTopOnChainGateways(gar).slice(
    0,
    TOP_ONCHAIN_GATEWAY_LIMIT
  ); // ✅ Limit to **Top 25**, avoid over-pinging

  if (topGateways.length === 0) {
    console.warn("⚠️ No top-performing gateways available.");
    return;
  }

  const now = Date.now();
  await Promise.allSettled(
    topGateways.map(async (gateway: AoGatewayWithAddress) => {
      const fqdn = gateway.settings.fqdn;
      const startTime = performance.now(); // ✅ Correctly record start time

      try {
        await fetch(`https://${fqdn}`, { method: "HEAD", mode: "no-cors" });
        updateGatewayPerformance(fqdn, startTime); // ✅ Pass the original start time
        return { fqdn, responseTime: performance.now() - startTime };
      } catch {
        updateGatewayPerformance(fqdn, startTime); // ❌ Still pass `startTime`, not 0
        return { fqdn, responseTime: Infinity };
      }
    })
  );

  // 🔥 Update last benchmark timestamp
  await chrome.storage.local.set({ lastBenchmarkTime: now });

  console.log("✅ Gateway benchmark completed and metrics updated.");
}

/**
 * Runs a **background validation** for **top performing gateways** instead of a single cached one.
 * - If they are too slow, marks them as stale.
 */
export async function backgroundValidateCachedGateway({
  ario,
}: {
  ario: AoARIORead;
}) {
  console.log("📡 Running lightweight background gateway validation...");

  const gar = await getGatewaysProvider().getGateways();
  const topGateways = selectTopOnChainGateways(gar).slice(0, 5); // 🔥 Validate top **5** gateways

  const now = Date.now();
  const pingResults = await Promise.allSettled(
    topGateways.map(async (gateway) => {
      const fqdn = gateway.settings.fqdn;
      const start = performance.now();
      try {
        await fetch(`https://${fqdn}`, { method: "HEAD", mode: "no-cors" });
        const responseTime = performance.now() - start;

        updateGatewayPerformance(fqdn, responseTime); // ✅ Update EMA

        return { fqdn, responseTime };
      } catch {
        updateGatewayPerformance(fqdn, 0); // ❌ Register failure
        return { fqdn, responseTime: Infinity };
      }
    })
  );

  // 🔄 If all fail, schedule a **full benchmark** instead
  if (
    pingResults.every((res) => (res as any).value?.responseTime === Infinity)
  ) {
    console.warn(
      "⚠️ Background validation failed. Scheduling full benchmark..."
    );
    await backgroundGatewayBenchmarking();
  } else {
    console.log("✅ Background validation completed.");
  }

  // 🔥 Update last validation timestamp
  await chrome.storage.local.set({ lastBenchmarkTime: now });
}

/**
 * Checks if a hostname belongs to a known AR.IO gateway.
 */
export async function isKnownGateway(fqdn: string): Promise<boolean> {
  const normalizedFQDN = await normalizeGatewayFQDN(fqdn);

  const { localGatewayAddressRegistry = {} } = await chrome.storage.local.get([
    "localGatewayAddressRegistry",
  ]);

  return Object.values(localGatewayAddressRegistry).some(
    (gw: any) => gw.settings.fqdn === normalizedFQDN
  );
}

/**
 * Updates gateway performance metrics using an Exponential Moving Average (EMA).
 */
export async function updateGatewayPerformance(
  rawFQDN: string, // The full hostname from the request
  startTime: number
) {
  const gatewayFQDN = await normalizeGatewayFQDN(rawFQDN); // ✅ Normalize before storage
  const responseTime = Math.max(0, performance.now() - startTime); // Prevent negatives

  // Ensure performance storage is initialized
  const storage = await chrome.storage.local.get(["gatewayPerformance"]);
  let gatewayPerformance = storage.gatewayPerformance || {};

  // Ensure the gateway entry exists
  if (!gatewayPerformance[gatewayFQDN]) {
    gatewayPerformance[gatewayFQDN] = {
      avgResponseTime: responseTime, // Set initial average
      failures: 0,
      successCount: 1, // First success
    };
  } else {
    const prevAvg =
      gatewayPerformance[gatewayFQDN].avgResponseTime || responseTime;
    const alpha = 0.2; // **Smoothing factor (higher = reacts faster, lower = more stable)**

    // 🔥 Compute new EMA for response time
    gatewayPerformance[gatewayFQDN].avgResponseTime =
      alpha * responseTime + (1 - alpha) * prevAvg;

    gatewayPerformance[gatewayFQDN].successCount += 1;
  }

  // console.log(
  //   `Updating Gateway Performance: ${gatewayFQDN} | New Response Time: ${responseTime} New Avg Response Time: ${gatewayPerformance[gatewayFQDN].avgResponseTime.toFixed(2)}ms`
  // );

  // 🔥 Store under the **root** FQDN
  await chrome.storage.local.set({ gatewayPerformance });
}

/**
 * Extracts the base gateway FQDN from a potentially subdomain-prefixed FQDN.
 * Ensures that ArNS subdomains and TXID-based URLs resolve to their root gateway.
 *
 * @param fqdn The full hostname from the request.
 * @returns The normalized gateway FQDN.
 */
export async function normalizeGatewayFQDN(fqdn: string): Promise<string> {
  const { localGatewayAddressRegistry = {} } = await chrome.storage.local.get([
    "localGatewayAddressRegistry",
  ]);

  const knownGateways = Object.values(localGatewayAddressRegistry).map(
    (gw: any) => gw.settings.fqdn
  );

  // ✅ Direct match (e.g., `arweave.net`)
  if (knownGateways.includes(fqdn)) {
    return fqdn;
  }

  // 🔍 Check if fqdn is a **subdomain** of a known gateway (e.g., `example.arweave.net`)
  for (const gatewayFQDN of knownGateways) {
    if (fqdn.endsWith(`.${gatewayFQDN}`)) {
      return gatewayFQDN; // ✅ Return base FQDN
    }
  }

  // 🚨 Unknown gateway fallback
  // console.warn(`⚠️ Unknown gateway encountered: ${fqdn}`);
  return fqdn;
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

export function isBase64URL(address: string): boolean {
  const trimmedBase64URL = address.toString().trim();
  const BASE_64_REXEX = new RegExp("^[a-zA-Z0-9-_s+]{43}$");
  return BASE_64_REXEX.test(trimmedBase64URL);
}
