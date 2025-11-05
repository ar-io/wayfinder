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
import { MultiNetworkSigner, Signer, wrapFetchWithPayment } from 'x402-fetch';

interface X402FetchConfig {
  fetch?: typeof globalThis.fetch;
  walletClient: Signer | MultiNetworkSigner;
  maxValue?: bigint;
}

/**
 * Creates a fetch function that uses x402-fetch for payment-aware data retrieval.
 * This wrapper integrates the x402-fetch library which handles 402 Payment Required
 * responses and payment flows for accessing x402 enabled gateway APIs.
 *
 * @param config - Optional x402-fetch configuration
 * @returns A fetch function with payment capabilities
 */
export function createX402Fetch(
  config: X402FetchConfig,
): typeof globalThis.fetch {
  const fetchFn = config.fetch ?? globalThis.fetch;
  const x402Fetch = wrapFetchWithPayment(fetchFn, config.walletClient);
  return x402Fetch as typeof globalThis.fetch;
}
