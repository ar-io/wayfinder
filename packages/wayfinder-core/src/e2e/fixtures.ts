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
 * Shared configuration for the end-to-end suite.
 *
 * These tests talk to the live AR.IO network (Solana mainnet registry + real
 * gateways). They are intentionally excluded from `test:unit` and from CI —
 * run them with `npm run test:e2e -w @ar.io/wayfinder-core` when you want to
 * know whether the deployed network still satisfies wayfinder's assumptions.
 *
 * Every knob is env-overridable so the suite can be pointed at devnet, a
 * staging gateway, or a locally running gateway.
 */

import type { Logger } from '../types.js';

/** Solana JSON-RPC endpoint backing the AR.IO gateway registry. */
export const SOLANA_RPC_URL =
  process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';

/**
 * Gateway used as the trusted source for verification and as the seed for
 * peer discovery. Defaults to the same gateway `createWayfinderClient()`
 * uses so the suite exercises the real default path.
 */
export const TRUSTED_GATEWAY =
  process.env.TRUSTED_GATEWAY ?? 'https://turbo-gateway.com';

/**
 * Additional known-good AR.IO gateways. Used where a test needs a gateway
 * that actually serves a given endpoint, so that a single unhealthy host
 * doesn't masquerade as a wayfinder regression.
 */
export const FALLBACK_GATEWAYS = (
  process.env.E2E_GATEWAYS ?? 'https://permagate.io,https://vevivo.art'
)
  .split(',')
  .map((g) => g.trim())
  .filter(Boolean);

/**
 * Transaction fixtures. The distinction between these matters more than it
 * looks: several strategies only apply to one shape of data, and picking the
 * wrong one produces failures that look like wayfinder bugs but aren't.
 */
export const FIXTURES = {
  /**
   * ANS-104 data item nested inside a bundle. Has the `x-ar-io-root-*`
   * headers that the chunk retrieval strategy requires.
   */
  bundledDataItem: {
    id: 'KKmRbIfrc7wiLcG0zvY1etlO0NBx1926dSCksxCIN3A',
    size: 71758,
    rootTxId: '8giZFBklEWZwGlMP-TQDMQEBX17MSu7AQDnhyByTfpE',
  },
  /**
   * Format-2 L1 transaction. Has a real `data_root`, so it is the only shape
   * that data-root and signature verification can be checked against.
   */
  l1FormatTwo: {
    id: 'Mfuh0Hybw1cIMeV44bVMkUBgozbeM89YKITztosefqk',
    size: 616,
  },
  /**
   * Format-1 (legacy) L1 transaction. `data_root` is empty by definition —
   * kept so the suite can assert that data-root verification degrades
   * predictably rather than silently comparing against an empty string.
   */
  l1FormatOne: {
    id: 'bNbA3TEQVL60xlgCcqdz4ZPHFZ711cZ3hmkpGttDt_U',
    size: 12517,
  },
  /** Long-lived ArNS names. */
  arnsName: 'ardrive',
} as const;

/** Per-test timeout. Live network calls are slow and occasionally retry. */
export const E2E_TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 90_000);

/** Silences strategy logging so test output stays readable. */
const noop = (): void => undefined;
export const quietLogger: Logger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};

/**
 * Reads a whole `Response` body, returning the byte length. Verification runs
 * as the stream is consumed, so tests must drain the body before asserting on
 * verification events.
 */
export async function drain(response: Response): Promise<number> {
  const buf = await response.arrayBuffer();
  return buf.byteLength;
}

/**
 * Retries `fn` when the Solana RPC rate-limits.
 *
 * Reading the gateway registry is a ~1.9MB `getProgramAccounts` call, and a
 * suite that makes several in quick succession will trip the public endpoint's
 * per-IP limit. That is infrastructure noise rather than a wayfinder failure,
 * so only HTTP 429 is retried — every other error propagates untouched.
 *
 * Pointing `SOLANA_RPC_URL` at a dedicated endpoint avoids this entirely.
 */
export async function withRpcRetry<T>(
  fn: () => Promise<T>,
  { attempts = 4, baseDelayMs = 1500 } = {},
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const isRateLimited =
        error?.context?.statusCode === 429 || /\(429\)/.test(error?.message);
      if (!isRateLimited || attempt === attempts) throw error;

      lastError = error;
      await new Promise((resolve) =>
        setTimeout(resolve, baseDelayMs * attempt),
      );
    }
  }

  throw lastError;
}

/**
 * Returns the first gateway that satisfies `predicate`, or throws listing what
 * was tried. Lets a test skip past hosts that don't serve a given endpoint
 * without pretending the wayfinder code is at fault.
 */
export async function firstGatewayWhere(
  gateways: string[],
  predicate: (gateway: string) => Promise<boolean>,
): Promise<string> {
  for (const gateway of gateways) {
    try {
      if (await predicate(gateway)) return gateway;
    } catch {
      // try the next one
    }
  }
  throw new Error(
    `No gateway satisfied the required condition. Tried: ${gateways.join(', ')}`,
  );
}
