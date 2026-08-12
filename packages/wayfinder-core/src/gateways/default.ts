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

import { defaultLogger } from '../logger.js';
import type { GatewaysProvider, Logger } from '../types.js';
import { CompositeGatewaysProvider } from './composite.js';
import { StaticGatewaysProvider } from './static.js';
import { TrustedPeersGatewaysProvider } from './trusted-peers.js';

/** Gateway used to discover peers and as the verification source by default. */
export const DEFAULT_TRUSTED_GATEWAY = 'https://turbo-gateway.com';

/**
 * The gateway source used when the caller doesn't supply one.
 *
 * Peer discovery is a single point of failure: a gateway can answer
 * `/ar-io/peers` with `200` and an empty `gateways` map, and when the default
 * trusted gateway does that, every routing strategy downstream fails with
 * "No gateways available" — the client cannot serve a single request. That has
 * been observed happening for sustained periods in production.
 *
 * Composing the peer lookup with a static fallback to the trusted gateway
 * itself turns that outage into a degradation: requests still succeed, routed
 * through the one gateway we already trust, instead of failing outright. The
 * fallback deliberately reuses `trustedGateway` rather than naming other
 * operators, so no additional gateway is promoted to a default.
 */
export function createDefaultGatewaysProvider({
  trustedGateway = DEFAULT_TRUSTED_GATEWAY,
  logger = defaultLogger,
}: {
  trustedGateway?: string;
  logger?: Logger;
} = {}): GatewaysProvider {
  return new CompositeGatewaysProvider({
    providers: [
      new TrustedPeersGatewaysProvider({ trustedGateway, logger }),
      new StaticGatewaysProvider({ gateways: [trustedGateway] }),
    ],
    logger,
  });
}
