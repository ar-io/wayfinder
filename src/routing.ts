import { AoARIORead, AoGatewayWithAddress, RandomGatewayStrategy, Wayfinder } from "@ar.io/sdk/web";
import {
  backgroundGatewayBenchmarking,
} from "./helpers";
import {
  DEFAULT_GATEWAY,
  TOP_ONCHAIN_GATEWAY_LIMIT,
  OPTIMAL_GATEWAY_ROUTE_METHOD,
  DNS_LOOKUP_API,
  GASLESS_ARNS_DNS_EXPIRATION_TIME,
} from "./constants";
import { GatewayRegistry } from "./types";
import { fetchEnsArweaveTxId } from "./ens";

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
    .slice(0, TOP_ONCHAIN_GATEWAY_LIMIT); // Take top 25

  return scoredGateways.length > 0 ? scoredGateways : Object.values(gar);
}


/**
 * Lookup the Arweave transaction ID for a given domain using DNS TXT records.
 * @param domain The domain to lookup.
 * @returns A promise that resolves to the Arweave transaction ID or null if not found.
 */
export async function lookupArweaveTxIdForDomain(
  domain: string
): Promise<string | null> {
  const cacheKey = `dnsCache_${domain}`;

  try {
    // Check cache first
    const cachedResult = await chrome.storage.local.get([cacheKey]);

    if (cachedResult && cachedResult[cacheKey]) {
      const { txId, timestamp } = cachedResult[cacheKey];

      if (Date.now() - timestamp < GASLESS_ARNS_DNS_EXPIRATION_TIME) {
        console.log(`Cache hit for ${domain}: ${txId}`);
        return txId;
      } else {
        console.log(`Cache expired for ${domain}, removing entry.`);
        await chrome.storage.local.remove(cacheKey);
      }
    }

    // Perform DNS lookup
    console.log("Checking DNS TXT record for:", domain);
    const response = await fetch(`${DNS_LOOKUP_API}?name=${domain}&type=TXT`);

    if (!response.ok) {
      console.error(`DNS lookup failed: ${response.statusText}`);
      return null;
    }

    const data = await response.json();

    // Extract Arweave transaction ID from TXT record
    const match = data.Answer?.map((record: any) => {
      const result = record.data.match(/ARTX ([a-zA-Z0-9_-]{43})/);
      return result ? result[1] : null; // Directly return extracted txId
    }).find((txId: string) => txId !== null);

    if (match) {
      // Cache result with timestamp
      await chrome.storage.local.set({
        [cacheKey]: { txId: match, timestamp: Date.now() },
      });

      console.log(`Cached result for ${domain}: ${match}`);
      return match;
    }

    return null;
  } catch (error) {
    console.error("❌ Failed to lookup DNS TXT records:", error);
    return null;
  }
}

/**
 * Get an optimal gateway based on the configured routing method.
 */
export async function getGatewayForRouting({
  ario,
}: {
  ario: AoARIORead;
}): Promise<string> {
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

  // Check if a refresh is needed (benchmark every 10 minutes)
  const now = Date.now();
  const TEN_MINUTES = 10 * 60 * 1000;

  if (now - lastGatewayBenchmark > TEN_MINUTES) {
    console.log("🔄 Running background benchmark in parallel...");
    backgroundGatewayBenchmarking({
      ario,
    }); // Run in parallel
    await chrome.storage.local.set({ lastGatewayBenchmark: now });
  }

  // TODO: replace with local variable
  const routingStrategy = new RandomGatewayStrategy({ ario });
  const wayfinder = new Wayfinder({ ario, routingStrategy });
  const gateway = await wayfinder.getTargetGateway();

  if (!gateway) {
    throw new Error("🚨 No viable gateway found.");
  }

  return gateway;
}

/**
 * Convert an ar:// URL to a routable gateway URL and return gateway metadata.
 * Supports:
 * - **ENS names** → `ar://example.eth` → Resolves to an Arweave TX
 * - **ArNS names** → `ar://example` → `https://example.{gatewayFQDN}`
 * - **Arweave TX IDs** → `ar://{txId}` → `https://{gatewayFQDN}/{txId}`
 *
 * @param arUrl The ar:// URL to convert.
 * @returns A promise resolving to an object containing the routable URL and gateway metadata.
 */
export async function getRoutableGatewayUrl({
  arUrl,
  ario,
}: {
  arUrl: string;
  ario: AoARIORead;
}): Promise<{
  url: string;
}> {
  try {
    if (!arUrl.startsWith("ar://")) {
      throw new Error(`Invalid ar:// URL format: ${arUrl}`);
    }

    const arUrlParts = arUrl.slice(5).split("/");
    const baseName = arUrlParts[0]; // Can be a TX ID, ArNS name, or ENS name
    const path =
      arUrlParts.length > 1 ? "/" + arUrlParts.slice(1).join("/") : "";

    // Select the best gateway based on routing method
    const gatewayFQDN = await getGatewayForRouting({ ario });

    let redirectTo: string;

    const storedSettings = await chrome.storage.local.get([
      "ensResolutionEnabled",
    ]);
    const ensResolutionEnabled = storedSettings.ensResolutionEnabled ?? false;

    if (/^[a-z0-9_-]{43}$/i.test(baseName)) {
      // ✅ Case 1: Arweave Transaction ID
      redirectTo = `https://${gatewayFQDN}${path}`;
    } else if (baseName.endsWith(".eth") && ensResolutionEnabled) {
      // ✅ Case 2: ENS Name Resolution
      console.log(`🔍 Resolving ENS name: ${baseName}`);

      const txId = await fetchEnsArweaveTxId(baseName);
      if (txId) {
        redirectTo = `https://${gatewayFQDN}${path}`;
      } else {
        throw new Error(
          `❌ ENS name ${baseName} does not have an Arweave TX ID.`
        );
      }
    } else if (baseName.includes(".")) {
      // ✅ Case 3: Arweave Domain (ArNS Resolution)
      console.log(`🔍 Resolving Gasless ArNS domain: ${baseName}`);

      const txId = await lookupArweaveTxIdForDomain(baseName);
      if (txId) {
        redirectTo = `https://${gatewayFQDN}${path}`;
      } else {
        console.warn(
          `⚠️ No transaction ID found for domain: ${baseName}. Falling back to root gateway domain access.`
        );
        redirectTo = `https://${gatewayFQDN}${path}`;
      }
    } else {
      // ✅ Case 4: ArNS Name (Subdomain Resolution)
      redirectTo = `https://${baseName}.${gatewayFQDN}${path}`;
    }

    return {
      url: redirectTo,
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
    };
  }
}
