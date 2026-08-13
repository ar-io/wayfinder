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
 * Verification strategies against real gateway data.
 *
 * Fixture choice is load-bearing here. Data-root and signature verification
 * need a format-2 L1 transaction: format-1 transactions carry an empty
 * `data_root`, and bundled data items have no L1 `/tx/<id>` record at all.
 * Testing those strategies against the wrong shape produces failures that
 * look like wayfinder bugs but are really fixture bugs.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { StaticRoutingStrategy } from '../routing/static.js';
import type { VerificationStrategy } from '../types.js';
import { DataRootVerificationStrategy } from '../verification/data-root-verification.js';
import { HashVerificationStrategy } from '../verification/hash-verification.js';
import { RemoteVerificationStrategy } from '../verification/remote-verification.js';
import { SignatureVerificationStrategy } from '../verification/signature-verification.js';
import { Wayfinder } from '../wayfinder.js';
import {
  E2E_TIMEOUT_MS,
  FALLBACK_GATEWAYS,
  FIXTURES,
  TRUSTED_GATEWAY,
  drain,
  firstGatewayWhere,
  quietLogger,
} from './fixtures.js';

/**
 * Drives a real request with strict verification enabled and reports whether
 * verification succeeded. Strict mode makes verification failures reject the
 * body read, so the result reflects the strategy's real verdict.
 */
async function verify({
  strategy,
  txId,
  gateway,
}: {
  strategy: VerificationStrategy;
  txId: string;
  gateway: string;
}): Promise<{ ok: boolean; bytes: number; error?: string }> {
  let succeeded = false;
  let failure: string | undefined;

  const wayfinder = new Wayfinder({
    logger: quietLogger,
    routingSettings: {
      strategy: new StaticRoutingStrategy({ gateway, logger: quietLogger }),
    },
    verificationSettings: {
      enabled: true,
      strict: true,
      strategy,
      events: {
        onVerificationSucceeded: () => {
          succeeded = true;
        },
        onVerificationFailed: (error: Error) => {
          failure = error?.message ?? String(error);
        },
      },
    },
  });

  // Depending on the strategy, a strict-mode failure surfaces either as a
  // rejected request (header-based checks run before streaming) or as a
  // rejected body read (stream-tapping checks). Both paths are handled here.
  try {
    const response = await wayfinder.request(`ar://${txId}`);
    const bytes = await drain(response);
    return { ok: succeeded && !failure, bytes, error: failure };
  } catch (error: any) {
    return { ok: false, bytes: 0, error: failure ?? error?.message };
  }
}

/** Finds a gateway that actually serves the L1 `/tx/<id>` record. */
async function gatewayServingTx(txId: string): Promise<string> {
  return firstGatewayWhere(
    [TRUSTED_GATEWAY, ...FALLBACK_GATEWAYS],
    async (gateway) => {
      const res = await fetch(`${gateway}/tx/${txId}`, {
        signal: AbortSignal.timeout(20_000),
      });
      return res.ok;
    },
  );
}

describe('e2e: verification strategies', { timeout: E2E_TIMEOUT_MS }, () => {
  it('HashVerificationStrategy verifies a bundled data item', async () => {
    const result = await verify({
      strategy: new HashVerificationStrategy({
        trustedGateways: [new URL(TRUSTED_GATEWAY)],
        logger: quietLogger,
      }),
      txId: FIXTURES.bundledDataItem.id,
      gateway: TRUSTED_GATEWAY,
    });

    assert.ok(result.ok, `hash verification failed: ${result.error}`);
    assert.strictEqual(result.bytes, FIXTURES.bundledDataItem.size);
  });

  it('DataRootVerificationStrategy verifies a format-2 L1 transaction', async () => {
    const gateway = await gatewayServingTx(FIXTURES.l1FormatTwo.id);
    const result = await verify({
      strategy: new DataRootVerificationStrategy({
        trustedGateways: [new URL(gateway)],
        logger: quietLogger,
      }),
      txId: FIXTURES.l1FormatTwo.id,
      gateway,
    });

    assert.ok(result.ok, `data-root verification failed: ${result.error}`);
    assert.strictEqual(result.bytes, FIXTURES.l1FormatTwo.size);
  });

  it('SignatureVerificationStrategy verifies a format-2 L1 transaction', async () => {
    const gateway = await gatewayServingTx(FIXTURES.l1FormatTwo.id);
    const result = await verify({
      strategy: new SignatureVerificationStrategy({
        trustedGateways: [new URL(gateway)],
        logger: quietLogger,
      }),
      txId: FIXTURES.l1FormatTwo.id,
      gateway,
    });

    assert.ok(result.ok, `signature verification failed: ${result.error}`);
    assert.strictEqual(result.bytes, FIXTURES.l1FormatTwo.size);
  });

  it('DataRootVerificationStrategy rejects a format-1 transaction rather than passing it', async () => {
    const gateway = await gatewayServingTx(FIXTURES.l1FormatOne.id);
    const result = await verify({
      strategy: new DataRootVerificationStrategy({
        trustedGateways: [new URL(gateway)],
        logger: quietLogger,
      }),
      txId: FIXTURES.l1FormatOne.id,
      gateway,
    });

    // Format-1 transactions have no data_root. The strategy cannot verify
    // them, and the important property is that it fails closed.
    assert.strictEqual(
      result.ok,
      false,
      'format-1 transaction was reported as verified despite having no data_root',
    );
  });

  it('RemoteVerificationStrategy reflects the gateway x-ar-io-verified header', async () => {
    const txId = FIXTURES.bundledDataItem.id;
    const response = await fetch(`${TRUSTED_GATEWAY}/${txId}`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    const headerSaysVerified =
      response.headers.get('x-ar-io-verified') === 'true';
    await response.arrayBuffer();

    // A strict-mode verification failure currently escapes as an unhandled
    // rejection from the stream tap in addition to rejecting the awaited
    // call, which would otherwise fail this test spuriously (and take down a
    // Node process running with the default --unhandled-rejections=throw).
    // Capture it for the duration of this test so the assertion below
    // measures the strategy's verdict rather than the leak.
    const leaked: unknown[] = [];
    const captureLeak = (reason: unknown) => leaked.push(reason);
    process.on('unhandledRejection', captureLeak);

    try {
      const result = await verify({
        strategy: new RemoteVerificationStrategy(),
        txId,
        gateway: TRUSTED_GATEWAY,
      });

      assert.strictEqual(
        result.ok,
        headerSaysVerified,
        `RemoteVerificationStrategy returned ${result.ok} but the gateway ` +
          `header reported verified=${headerSaysVerified}`,
      );
    } finally {
      process.off('unhandledRejection', captureLeak);
    }
  });

  it('strict mode surfaces a verification failure to the caller', async () => {
    // A trusted gateway that cannot supply verification material must fail
    // closed rather than silently returning unverified bytes.
    const result = await verify({
      strategy: new DataRootVerificationStrategy({
        trustedGateways: [new URL('https://gateway.invalid')],
        logger: quietLogger,
      }),
      txId: FIXTURES.l1FormatTwo.id,
      gateway: TRUSTED_GATEWAY,
    });

    assert.strictEqual(result.ok, false);
  });

  it('verification is off unless explicitly enabled', async () => {
    const wayfinder = new Wayfinder({
      logger: quietLogger,
      routingSettings: {
        strategy: new StaticRoutingStrategy({
          gateway: TRUSTED_GATEWAY,
          logger: quietLogger,
        }),
      },
    });

    assert.strictEqual(wayfinder.verificationSettings.enabled, false);

    const response = await wayfinder.request(
      `ar://${FIXTURES.bundledDataItem.id}`,
    );
    const bytes = await drain(response);

    assert.strictEqual(bytes, FIXTURES.bundledDataItem.size);
  });
});
