/**
 * WayFinder
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * Checks if a hostname belongs to a known AR.IO gateway.
 */
export async function isKnownGateway(fqdn: string): Promise<boolean> {
  const normalizedFQDN = await normalizeGatewayFQDN(fqdn);

  const { localGatewayAddressRegistry = {} } = await chrome.storage.local.get([
    'localGatewayAddressRegistry',
  ]);

  return Object.values(localGatewayAddressRegistry).some(
    (gw: any) => gw.settings.fqdn === normalizedFQDN,
  );
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
    'localGatewayAddressRegistry',
  ]);

  const knownGateways = Object.values(localGatewayAddressRegistry).map(
    (gw: any) => gw.settings.fqdn,
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

  // Unknown gateway fallback
  // logger.warn(`Unknown gateway encountered: ${fqdn}`);
  return fqdn;
}
