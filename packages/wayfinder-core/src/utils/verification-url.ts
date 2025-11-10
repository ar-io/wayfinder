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

import { sandboxFromId } from './base64.js';

/**
 * Constructs a verification URL for a transaction, using localhost-aware routing
 * @param gateway - The gateway URL to use for verification
 * @param txId - The transaction ID
 * @param path - Optional path to append (e.g., '/data_root', '/tx/', etc.)
 * @returns The constructed verification URL
 */
export function constructVerificationUrl({
  gateway,
  txId,
  path = '',
}: {
  gateway: URL;
  txId: string;
  path?: string;
}): string {
  const port = gateway.port ? `:${gateway.port}` : '';
  // For localhost, use port-based routing instead of subdomain routing
  if (gateway.hostname === 'localhost' || gateway.hostname === '127.0.0.1') {
    return `${gateway.protocol}//${gateway.hostname}${port}${path}/${txId}`;
  } else {
    // For non-localhost, use subdomain routing with sandbox
    const sandbox = sandboxFromId(txId);
    return `${gateway.protocol}//${sandbox}.${gateway.hostname}${port}${path}/${txId}`;
  }
}

/**
 * Constructs a verification URL for a gateway endpoint without sandbox routing
 * @param gateway - The gateway URL to use for verification
 * @param path - The path to append (e.g., '/tx/txId/data_root')
 * @returns The constructed verification URL
 */
export function constructGatewayUrl({
  gateway,
  path,
}: {
  gateway: URL;
  path: string;
}): string {
  return `${gateway.toString().replace(/\/$/, '')}${path}`;
}
