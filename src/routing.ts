import { AoGatewayWithAddress } from "@ar.io/sdk/web";
import { backgroundGatewayBenchmarking, backgroundValidateCachedGateway } from "./helpers";
import { DEFAULT_GATEWAY, TOP_ONCHAIN_GATEWAY_LIMIT, HIGHEST_STAKE_ROUTE_METHOD, OPTIMAL_GATEWAY_ROUTE_METHOD, RANDOM_ROUTE_METHOD, RANDOM_TOP_FIVE_STAKED_ROUTE_METHOD, STAKE_RANDOM_ROUTE_METHOD, WEIGHTED_ONCHAIN_PERFORMANCE_ROUTE_METHOD } from "./constants";
import { GatewayRegistry } from "./types";

/**
 * Fetch the filtered Gateway Address Registry (GAR) from storage.
 * Ensures blacklisted and unjoined gateways are removed before routing decisions.
 */
export async function getGarForRouting(): Promise<GatewayRegistry> {
  const { localGatewayAddressRegistry = {}, blacklistedGateways = [] } =
    (await chrome.storage.local.get([
      "localGatewayAddressRegistry",
      "blacklistedGateways",
    ])) as {
      localGatewayAddressRegistry: GatewayRegistry;
      blacklistedGateways: string[];
    };

  const filteredGar: GatewayRegistry = Object.fromEntries(
    Object.entries(localGatewayAddressRegistry).filter(
      ([gatewayAddress, gateway]) =>
        !blacklistedGateways.includes(gatewayAddress) &&
        gateway.status === "joined"
    )
  );

  return Object.keys(filteredGar).length > 0 ? filteredGar : {};
}

/**
 * Selects a random gateway from the stored Gateway Address Registry.
 */
export function selectRandomGateway(
  gar: GatewayRegistry
): AoGatewayWithAddress {
  const gateways = Object.values(gar);

  if (gateways.length === 0) {
    console.warn("⚠️ No gateways found in GAR.");
    return selectHighestStakedGateway(gar);
  }

  return gateways[Math.floor(Math.random() * gateways.length)];
}

/**
 * Select a weighted random gateway based on total stake (operator + delegated).
 */
export function selectWeightedGateway(
  gar: GatewayRegistry
): AoGatewayWithAddress {
  const gateways = Object.values(gar);

  const getTotalStake = (gateway: AoGatewayWithAddress): number =>
    gateway.operatorStake + gateway.totalDelegatedStake;

  const totalStake = gateways.reduce((sum, gw) => sum + getTotalStake(gw), 0);

  if (totalStake === 0) {
    console.warn("⚠️ No gateways with stake available.");
    return selectHighestStakedGateway(gar);
  }

  let randomNum = Math.random() * totalStake;
  for (const gateway of gateways) {
    randomNum -= getTotalStake(gateway);
    if (randomNum <= 0) {
      return gateway;
    }
  }

  console.warn("⚠️ Unexpected failure in weighted selection.");
  return selectHighestStakedGateway(gar);
}

/**
 * Select the highest-staked gateway from the stored GAR.
 */
export function selectHighestStakedGateway(
  gar: GatewayRegistry
): AoGatewayWithAddress {
  const gateways = Object.values(gar);

  if (gateways.length === 0) {
    throw new Error("❌ No gateways available for fallback.");
  }

  return gateways.reduce((prev, current) =>
    current.operatorStake + current.totalDelegatedStake >
    prev.operatorStake + prev.totalDelegatedStake
      ? current
      : prev
  );
}

/**
 * Selects a random gateway from the top five staked gateways.
 */
export function selectRandomTopFiveStakedGateway(
  gar: GatewayRegistry
): AoGatewayWithAddress {
  const gateways = Object.values(gar)
    .sort(
      (a, b) =>
        b.operatorStake +
        b.totalDelegatedStake -
        (a.operatorStake + a.totalDelegatedStake)
    )
    .slice(0, 5);

  if (gateways.length === 0) {
    console.warn("⚠️ No top-staked gateways found.");
    return selectHighestStakedGateway(gar);
  }

  return gateways[Math.floor(Math.random() * gateways.length)];
}

/**
 * Computes a performance-based score for each gateway using on-chain metrics.
 * - **Stake Weight (50%)**
 * - **Tenure Weight (10%)**
 * - **Gateway Performance Ratio (15%)**
 * - **Observer Performance Ratio (5%)**
 * - **Stability Boost (Log of Passed Consecutive Epochs) (15%)**
 * - **Failure Penalty (Logarithmic Penalty for Failed Consecutive Epochs) (-20%)**
 *
 * @param gar The Gateway Address Registry.
 * @returns An array of gateways with computed scores.
 */
export function computeOnChainGatewayScores(
  gar: GatewayRegistry
): { gateway: AoGatewayWithAddress; score: number }[] {
  const alpha = 0.5; // Stake weight (50%)
  const beta = 0.1; // Tenure weight (10%)
  const gamma = 0.15; // Gateway performance weight (15%)
  const delta = 0.05; // Observer performance weight (5%)
  const epsilon = 0.15; // Stability weight (log-based)
  const zeta = -0.2; // Failure penalty (-20% per failed epoch, capped at -0.8)

  return Object.values(gar).map((gateway) => {
    const weights = gateway.weights ?? {};
    const stats = gateway.stats ?? {};

    const stakeWeight = weights.stakeWeight ?? 0;
    const tenureWeight = weights.tenureWeight ?? 0;
    const gatewayPerfWeight = weights.gatewayRewardRatioWeight ?? 0;
    const observerPerfWeight = weights.observerRewardRatioWeight ?? 0;

    const stabilityFactor = Math.log1p(stats.passedConsecutiveEpochs ?? 0);
    const failurePenalty =
      stats.failedConsecutiveEpochs > 0
        ? Math.max(zeta * Math.log1p(stats.failedConsecutiveEpochs), -0.8)
        : 0;

    const score =
      alpha * stakeWeight +
      beta * tenureWeight +
      gamma * gatewayPerfWeight +
      delta * observerPerfWeight +
      epsilon * stabilityFactor +
      failurePenalty;

    return { gateway, score };
  });
}

/**
 * Selects the **top 25** gateways based on on-chain performance scores.
 *
 * @param gar The Gateway Address Registry.
 * @returns The top 25 performing gateways based on their computed scores.
 */
export function selectTopOnChainGateways(
  gar: GatewayRegistry
): AoGatewayWithAddress[] {
  const scoredGateways = computeOnChainGatewayScores(gar)
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ gateway }) => gateway)
    .slice(0, 25); // Take top 25

  return scoredGateways.length > 0 ? scoredGateways : Object.values(gar);
}

  /**
 * Selects a **random weighted gateway** using on-chain metrics.
 *
 * @param gar The Gateway Address Registry.
 * @returns A randomly selected on-chain weighted gateway.
 */
export async function selectWeightedOnchainPerformanceGateway(
  gar: GatewayRegistry
): Promise<AoGatewayWithAddress> {
  const scoredGateways = computeOnChainGatewayScores(gar)
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score); // Sort in descending order

  if (scoredGateways.length === 0) {
    console.warn("⚠️ No valid weighted gateways. Falling back.");
    return selectHighestStakedGateway(gar);
  }

    // Debug log gateway score distribution (no normalization)
    console.log(
      "🎯 Scored Gateway Selection Candidates:",
      scoredGateways.map((gw) => ({
        fqdn: gw.gateway.settings.fqdn,
        rawScore: gw.score.toFixed(2),
      }))
    );

    // Apply an exponential weight boost to favor top-performing gateways
  const scorePower = 1.5; // Adjusting exponentiation makes top gateways more dominant
  const weightedGateways = scoredGateways.map(({ gateway, score }) => ({
    gateway,
    weight: Math.pow(score, scorePower), // Exponentially boost high scores
  }));

    // Debug log gateway score distribution (no normalization)
    console.log(
      "🎯 Weighted Gateway Selection Candidates:",
      weightedGateways.map((gw) => ({
        fqdn: gw.gateway.settings.fqdn,
        rawScore: gw.weight.toFixed(2),
      }))
    );


  // Compute the total weight (sum of all scores after transformation)
  const totalWeight = weightedGateways.reduce((sum, gw) => sum + gw.weight, 0);

  // Generate a random number in the range [0, totalWeight]
  let randomNum = Math.random() * totalWeight;

  // Precompute cumulative weights for selection
  let cumulativeWeight = 0;
  for (const { gateway, weight } of weightedGateways) {
    cumulativeWeight += weight;
    if (randomNum <= cumulativeWeight) {
      console.log(`✅ Selected Weighted Gateway: ${gateway.settings.fqdn}`);
      return gateway;
    }
  }

  // Fallback to highest-staked gateway (should never happen)
  console.warn("⚠️ Weighted selection failed unexpectedly, falling back.");
  return selectHighestStakedGateway(gar);

}

/**
 * Selects the best gateway by combining on-chain metrics (stake, tenure, performance)
 * and off-chain real-time metrics (EMA-based response time).
 *
 * - Uses **on-chain scores** to get **top-ranked** gateways.
 * - Excludes gateways with **high failure rates**.
 * - Chooses the gateway with **lowest EMA response time** (if available).
 * - If no EMA exists, **runs a lightweight ping** to validate.
 * - **Asynchronously refreshes performance data** without delaying request.
 * - **Fully decentralized** - does not depend on global caching.
 *
 * @returns A promise resolving to the best available gateway.
 */
export async function selectOptimalGateway(
  gar: GatewayRegistry
): Promise<string> {
  if (!gar || Object.keys(gar).length === 0) {
    console.warn("⚠️ GAR is empty. Falling back to highest-staked gateway.");
    return `https://${selectHighestStakedGateway(gar).settings.fqdn}`;
  }

  // ✅ Fetch performance metrics from local storage
  const { gatewayPerformance, lastBenchmarkTime } =
    await chrome.storage.local.get(["gatewayPerformance", "lastBenchmarkTime"]);

  const now = Date.now();
  const CACHE_EXPIRY = 5 * 60 * 1000; // 🔥 Expire cached data after 5 minutes

  // ✅ 1️⃣ Select the **best on-chain gateways**
  const topGateways = selectTopOnChainGateways(gar).slice(0, 25); // 🔥 **Top 25 for selection**

  // ✅ 2️⃣ Filter out **unresponsive** gateways
  const validGateways = topGateways.filter((gateway) => {
    const fqdn = gateway.settings.fqdn;
    const perf = gatewayPerformance?.[fqdn];

    // ❌ Exclude if response time is Infinity (failed pings)
    if (!perf || perf.avgResponseTime === Infinity || isNaN(perf.avgResponseTime)) return false;

    // ❌ Exclude if gateway has failed too many times
    if (perf.failures >= 10) return false;

    return true;
  });

  if (validGateways.length === 0) {
    console.warn("⚠️ All top-ranked gateways are failing. Running full benchmark...");
    backgroundGatewayBenchmarking();
    return `https://${selectHighestStakedGateway(gar).settings.fqdn}`;
  }

  // ✅ 3️⃣ Rank them by **lowest EMA response time**, filtering again to ensure no Infinity values
  const rankedGateways = validGateways
    .map((gateway) => ({
      fqdn: gateway.settings.fqdn,
      score: gateway.weights.compositeWeight || 0, // On-chain weight
      avgResponseTime: gatewayPerformance?.[gateway.settings.fqdn]?.avgResponseTime || 5000, // Default to 5s if missing
    }))
    .filter(({ avgResponseTime }) => avgResponseTime < Infinity) // 🔥 Double check here
    .sort((a, b) => a.avgResponseTime - b.avgResponseTime);

  console.log("📊 Ranked Gateway Candidates:", rankedGateways);

  // ✅ 4️⃣ Use lowest-latency gateway **if response time is valid**
  for (const { fqdn, avgResponseTime } of rankedGateways) {
    if (avgResponseTime < 5000) {
      console.log(`🚀 Using Best Performing Gateway: ${fqdn} (${avgResponseTime.toFixed(2)}ms)`);

      // 🔄 **Trigger background refresh if data is stale**
      if (!lastBenchmarkTime || now - lastBenchmarkTime >= CACHE_EXPIRY) {
        console.log("🔄 Scheduling background benchmark refresh...");
        backgroundValidateCachedGateway();
      }

      return `https://${fqdn}`;
    }
  }

  // ✅ 5️⃣ If no valid EMA exists, **run a quick validation ping**
  console.warn("⚠️ No reliable EMA data. Running quick validation ping...");
  for (const { fqdn } of rankedGateways.slice(0, 3)) {
    const start = performance.now();
    try {
      await fetch(`https://${fqdn}`, { method: "HEAD", mode: "no-cors" });
      const responseTime = performance.now() - start;

      if (responseTime < 2000) {
        console.log(`✅ New Fast Gateway Selected: ${fqdn} (${responseTime.toFixed(2)}ms)`);
        await chrome.storage.local.set({ lastBenchmarkTime: now });
        return `https://${fqdn}`;
      }
    } catch {
      console.warn(`❌ Failed to reach ${fqdn}`);
    }
  }

  // ✅ 6️⃣ If **all fail**, trigger **full benchmark** asynchronously
  console.warn("⚠️ No fast gateways found. Running full benchmark...");
  backgroundGatewayBenchmarking();

  // ✅ 7️⃣ Use **fallback best on-chain weighted gateway**
  console.warn("⚠️ No real-time fast gateway found. Falling back to on-chain weighted gateway.");
  const fallbackGateway = await selectWeightedOnchainPerformanceGateway(gar);
  return `https://${fallbackGateway.settings.fqdn}`;
}



/**
 * Lookup the Arweave transaction ID for a given domain using DNS TXT records.
 * @param domain The domain to lookup.
 * @returns A promise that resolves to the Arweave transaction ID or null if not found.
 */
export async function lookupArweaveTxIdForDomain(
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
      "❌ Failed to lookup DNS TXT records:",
      (error as Error).message
    );
  }
  return null;
}

/**
 * Get an optimal gateway based on the configured routing method.
 */
export async function getGatewayForRouting(): Promise<AoGatewayWithAddress> {
  const {
    staticGateway,
    routingMethod = OPTIMAL_GATEWAY_ROUTE_METHOD,
    lastGatewayBenchmark = 0, // Default to 0 if not set
  } = await chrome.storage.local.get([
    "staticGateway",
    "routingMethod",
    "lastGatewayBenchmark",
  ]);

  if (staticGateway) {
    console.log("🚀 Using Static Gateway:", staticGateway.settings.fqdn);
    return staticGateway;
  }

  const filteredGar = await getGarForRouting();
  let gateway: AoGatewayWithAddress | null = null;

  // Check if a refresh is needed (benchmark every 10 minutes)
  const now = Date.now();
  const TEN_MINUTES = 10 * 60 * 1000;

  if (now - lastGatewayBenchmark > TEN_MINUTES) {
    console.log("🔄 Running background benchmark in parallel...");
    backgroundGatewayBenchmarking(); // Run in parallel
    await chrome.storage.local.set({ lastGatewayBenchmark: now });
  }

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
      gateway = selectHighestStakedGateway(filteredGar);
      break;
    case WEIGHTED_ONCHAIN_PERFORMANCE_ROUTE_METHOD:
      console.log("⛓️ Using Select Weighted Onchain Performance Gateway...");
      gateway = await selectWeightedOnchainPerformanceGateway(filteredGar);
      break;
    case OPTIMAL_GATEWAY_ROUTE_METHOD:
      console.log("🚀 Using Select Optimal Gateway Method...");
      try {
        const bestGatewayFQDN = await selectOptimalGateway(filteredGar);
        gateway =
          Object.values(filteredGar).find(
            (g) => g.settings.fqdn === bestGatewayFQDN.replace("https://", "")
          ) || null;
      } catch (error) {
        console.error("❌ Error selecting optimal gateway:", error);
      }
      break;
    default:
      console.warn(
        `⚠️ Unknown routing method: ${routingMethod}, defaulting to RANDOM_ROUTE_METHOD.`
      );
      gateway = selectRandomGateway(filteredGar);
      break;
  }

  if (!gateway) {
    console.error(
      "❌ No valid gateway found. Falling back to highest-staked gateway."
    );
    gateway = selectHighestStakedGateway(filteredGar);
  }

  if (!gateway) {
    throw new Error("🚨 No viable gateway found.");
  }

  return gateway;
}

/**
 * Convert an ar:// URL to a routable gateway URL and return gateway metadata.
 * Supports:
 * - **ArNS names** → `ar://example` → `https://example.{gatewayFQDN}`
 * - **Arweave TX IDs** → `ar://{txId}` → `https://{gatewayFQDN}/{txId}`
 *
 * @param arUrl The ar:// URL to convert.
 * @returns A promise resolving to an object containing the routable URL and gateway metadata.
 */
export async function getRoutableGatewayUrl(arUrl: string): Promise<{
  url: string;
  gatewayFQDN: string;
  gatewayProtocol: string;
  gatewayPort: number | null;
  gatewayAddress: string;
  selectedGateway: AoGatewayWithAddress;
}> {
  try {
    if (!arUrl.startsWith("ar://")) {
      throw new Error(`Invalid ar:// URL format: ${arUrl}`);
    }

    const arUrlParts = arUrl.slice(5).split("/");
    const baseName = arUrlParts[0]; // Can be a TX ID or an ArNS name
    const path =
      arUrlParts.length > 1 ? "/" + arUrlParts.slice(1).join("/") : "";

    // Select the best gateway based on routing method
    const selectedGateway = await getGatewayForRouting();

    // Extract gateway metadata
    const gatewayFQDN = selectedGateway.settings.fqdn;
    const gatewayProtocol = selectedGateway.settings.protocol;
    const gatewayPort = selectedGateway.settings.port || null;
    const gatewayAddress = selectedGateway.gatewayAddress || "UNKNOWN";

    let redirectTo: string;

    if (/^[a-z0-9_-]{43}$/i.test(baseName)) {
      // ✅ Case 1: Arweave Transaction ID
      redirectTo = `${gatewayProtocol}://${gatewayFQDN}${gatewayPort ? `:${gatewayPort}` : ""}/${baseName}${path}`;
    } else if (baseName.includes(".")) {
      // ✅ Case 2: Arweave domain (needs resolution)
      console.log(`🔍 Resolving Arweave domain: ${baseName}`);

      const txId = await lookupArweaveTxIdForDomain(baseName);
      if (txId) {
        redirectTo = `${gatewayProtocol}://${gatewayFQDN}${gatewayPort ? `:${gatewayPort}` : ""}/${txId}${path}`;
      } else {
        console.warn(
          `⚠️ No transaction ID found for domain: ${baseName}. Falling back to direct subdomain access.`
        );
        redirectTo = `${gatewayProtocol}://${baseName}.${gatewayFQDN}${gatewayPort ? `:${gatewayPort}` : ""}${path}`;
      }
    } else {
      // ✅ Case 3: ArNS name (subdomain resolution)
      redirectTo = `${gatewayProtocol}://${baseName}.${gatewayFQDN}${gatewayPort ? `:${gatewayPort}` : ""}${path}`;
    }

    return {
      url: redirectTo,
      gatewayFQDN,
      gatewayProtocol,
      gatewayPort,
      gatewayAddress,
      selectedGateway,
    };
  } catch (error) {
    console.error("🚨 Error in getRoutableGatewayUrl:", error);

    // Attempt to use highest-staked gateway as a last resort
    const fallbackGateway = DEFAULT_GATEWAY;
    if (!fallbackGateway) {
      throw new Error("❌ No viable gateway even for fallback.");
    }

    return {
      url: `https://${fallbackGateway.settings.fqdn}`,
      gatewayFQDN: fallbackGateway.settings.fqdn,
      gatewayProtocol: fallbackGateway.settings.protocol,
      gatewayPort: fallbackGateway.settings.port || null,
      gatewayAddress: fallbackGateway.gatewayAddress || "UNKNOWN",
      selectedGateway: fallbackGateway,
    };
  }
}
