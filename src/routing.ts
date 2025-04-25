/**
 * AR.IO Gateway
 * Copyright (C) 2022-2023 Permanent Data Solutions, Inc. All Rights Reserved.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
import { AoGatewayWithAddress } from "@ar.io/sdk/web";
import {
  TOP_ONCHAIN_GATEWAY_LIMIT,
  DNS_LOOKUP_API,
  GASLESS_ARNS_DNS_EXPIRATION_TIME,
} from "./constants";

/**
 * Computes a performance-based score for each gateway using on-chain metrics.
 * - **Stake Weight (50%)**
 * - **Tenure Weight (10%)**
 * - **Gateway Performance Ratio (15%)**
 * - **Observer Performance Ratio (5%)**
 * - **Stability Boost (Log of Passed Consecutive Epochs) (15%)**
 * - **Failure Penalty (Logarithmic Penalty for Failed Consecutive Epochs) (-20%)**
 *
 * @param gateways The Gateway Address Registry.
 * @returns An array of gateways with computed scores.
 */
export function computeOnChainGatewayScores(
  gateways: AoGatewayWithAddress[]
): { gateway: AoGatewayWithAddress; score: number }[] {
  const alpha = 0.5; // Stake weight (50%)
  const beta = 0.1; // Tenure weight (10%)
  const gamma = 0.15; // Gateway performance weight (15%)
  const delta = 0.05; // Observer performance weight (5%)
  const epsilon = 0.15; // Stability weight (log-based)
  const zeta = -0.2; // Failure penalty (-20% per failed epoch, capped at -0.8)

  return gateways.map((gateway) => {
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
  gateways: AoGatewayWithAddress[]
): AoGatewayWithAddress[] {
  const scoredGateways = computeOnChainGatewayScores(gateways)
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ gateway }) => gateway)
    .slice(0, TOP_ONCHAIN_GATEWAY_LIMIT); // Take top 25

  return scoredGateways.length > 0 ? scoredGateways : gateways;
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
