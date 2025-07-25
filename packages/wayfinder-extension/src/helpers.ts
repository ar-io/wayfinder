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
// Cache for gateway registry to avoid repeated Chrome storage reads
let gatewayCache: { registry: any; timestamp: number } | null = null;
const GATEWAY_CACHE_TTL_MS = 3600000; // 1 hour

export async function getCachedGatewayRegistry(): Promise<any> {
  const now = Date.now();
  if (gatewayCache && now - gatewayCache.timestamp < GATEWAY_CACHE_TTL_MS) {
    return gatewayCache.registry;
  }

  const { localGatewayAddressRegistry = {} } = await chrome.storage.local.get([
    'localGatewayAddressRegistry',
  ]);

  gatewayCache = {
    registry: localGatewayAddressRegistry,
    timestamp: now,
  };

  return localGatewayAddressRegistry;
}
