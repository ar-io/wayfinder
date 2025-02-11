import { AoGatewayWithAddress } from "@ar.io/sdk/web";
import { backgroundGatewayBenchmarking } from "./helpers";

type GatewayRegistry = Record<string, AoGatewayWithAddress>;

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
    passedEpochCount: 0,
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
    gatewayPerformanceRatio: 0,
    observerPerformanceRatio: 0,
  },
  startTimestamp: 0,
  endTimestamp: 0,
  observerAddress: "",
  services: {
    bundlers: [],
  },
  gatewayAddress: "DEFAULT",
};

export const RANDOM_ROUTE_METHOD = "random";
export const STAKE_RANDOM_ROUTE_METHOD = "stakeRandom";
export const HIGHEST_STAKE_ROUTE_METHOD = "highestStake";
export const RANDOM_TOP_FIVE_STAKED_ROUTE_METHOD = "topFiveStake";
export const WEIGHTED_ONCHAIN_PERFORMANCE_ROUTE_METHOD =
  "weightedOnchainPerformance";
export const OPTIMAL_GATEWAY_ROUTE_METHOD = "optimalGateway";

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
  const zeta = -0.2; // Failure penalty (-20% per failed epoch, capped at -0.6)

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
        ? Math.max(zeta * Math.log1p(stats.failedConsecutiveEpochs), -0.6)
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

  // Normalize weights
  const totalWeight = scoredGateways.reduce((sum, gw) => sum + gw.score, 0);
  const normalizedGateways = scoredGateways.map((gw) => ({
    gateway: gw.gateway,
    weight: gw.score / totalWeight,
  }));

  // Debug log gateway weight distribution
  console.log(
    "🎯 Weighted Gateway Selection Candidates:",
    normalizedGateways.map((gw) => ({
      fqdn: gw.gateway.settings.fqdn,
      weight: gw.weight.toFixed(4),
    }))
  );

  // Weighted selection
  let randomNum = Math.random();
  for (const { gateway, weight } of normalizedGateways) {
    randomNum -= weight;
    if (randomNum <= 0) {
      console.log(`✅ Selected Weighted Gateway: ${gateway.settings.fqdn}`);
      return gateway;
    }
  }

  console.warn("⚠️ Weighted selection failed unexpectedly, falling back.");
  return selectHighestStakedGateway(gar);
}

/**
 * Selects the best gateway by combining on-chain metrics (stake, tenure, performance)
 * and off-chain real-time metrics (response time, success rate).
 *
 * If no performance data exists, it relies **only on on-chain data**.
 * This allows Wayfinder to "cold start" and collect performance metrics over time.
 *
 * @returns A promise resolving to the best available gateway.
 */
export async function selectOptimalGateway(
  gar: GatewayRegistry
): Promise<string> {
  if (!gar || Object.keys(gar).length === 0) {
    console.warn("⚠️ GAR is empty. Falling back to highest-staked gateway.");
    const fallbackGateway = selectHighestStakedGateway(gar);
    if (!fallbackGateway) throw new Error("❌ No viable gateways found.");
    return `https://${fallbackGateway.settings.fqdn}`;
  }

  const { gatewayPerformance, cachedFastestGateway } =
    await chrome.storage.local.get([
      "gatewayPerformance",
      "cachedFastestGateway",
    ]);

  if (cachedFastestGateway && gatewayPerformance?.[cachedFastestGateway]) {
    const lastResponseTime =
      gatewayPerformance[cachedFastestGateway].responseTimes.slice(-1)[0] ||
      Infinity;
    if (lastResponseTime < 2000) {
      console.log(`🚀 Using Cached Fastest Gateway: ${cachedFastestGateway}`);
      return `https://${cachedFastestGateway}`;
    }
  }

  console.log("📡 Pinging top-ranked gateways for real-time response time...");
  const topCandidates = selectTopOnChainGateways(gar).slice(0, 5); // 🔥 Now based on **on-chain score**

  const pingResults = await Promise.all(
    topCandidates.map(async (gateway) => {
      const fqdn = gateway.settings.fqdn;
      const start = performance.now();
      try {
        await fetch(`https://${fqdn}`, { method: "HEAD", mode: "no-cors" });
        return { fqdn, responseTime: performance.now() - start };
      } catch {
        return { fqdn, responseTime: Infinity };
      }
    })
  );

  const fastestGateway = pingResults.sort(
    (a, b) => a.responseTime - b.responseTime
  )[0];

  if (fastestGateway.responseTime < 2000) {
    console.log(
      `✅ Selected Real-Time Fastest Gateway: ${fastestGateway.fqdn}`
    );
    await chrome.storage.local.set({
      cachedFastestGateway: fastestGateway.fqdn,
    });
    return `https://${fastestGateway.fqdn}`;
  }

  console.warn(
    "⚠️ No fast gateways found. Falling back to best on-chain gateway."
  );
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
    const fallbackGateway = defaultGateway;
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
