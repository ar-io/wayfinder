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
import { createX402Fetch } from '@ar.io/wayfinder-x402-fetch';
import { privateKeyToAccount } from 'viem/accounts';
import { createVerificationStrategy } from '../packages/wayfinder-core/src/index.js';
import { ChunkDataRetrievalStrategy } from '../packages/wayfinder-core/src/retrieval/chunk.js';
import { StaticRoutingStrategy } from '../packages/wayfinder-core/src/routing/static.js';
import {
  VerificationStrategy,
  WayfinderEvent,
} from '../packages/wayfinder-core/src/types.js';
import { VerificationOption } from '../packages/wayfinder-core/src/types.js';
import { Wayfinder } from '../packages/wayfinder-core/src/wayfinder.js';

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const txIdOrArns = args[0];
  const strategyType = args[1] || 'hash';
  const gateway = args[2] || 'http://localhost:3000';
  const privateKey = process.env.X402_TEST_PRIVATE_KEY as
    | `0x${string}`
    | undefined;

  if (!txIdOrArns) {
    console.error(
      'Usage: node verify.js <tx-id|arns> [verification-strategy] [gateway] [private-key]',
    );
    console.error(
      'Verification strategy options: data-root, hash, signature (default: hash)',
    );
    process.exit(1);
  }

  if (!['data-root', 'hash', 'signature'].includes(strategyType)) {
    console.error(
      'Invalid verification strategy. Options: data-root, hash, signature',
    );
    process.exit(1);
  }

  if (!privateKey) {
    console.warn('Private key is required for x402-fetch. Using native fetch.');
  }

  return { txIdOrArns, strategyType, gateway, privateKey };
}

async function main() {
  const { txIdOrArns, strategyType, gateway, privateKey } = parseArgs();

  console.log(
    `Verifying transaction ${txIdOrArns} using ${strategyType} verification with ChunkDataRetrievalStrategy...`,
  );

  try {
    let fetchToUse: typeof globalThis.fetch = globalThis.fetch;

    if (privateKey) {
      // Create EthereumSigner with the private key
      const signer = privateKeyToAccount(privateKey);

      // Create x402-fetch with the signer
      const x402Fetch = createX402Fetch({
        walletClient: signer,
        maxValue: BigInt(100000000000), // 100 gwei max payment
      });
      fetchToUse = x402Fetch;
    }

    // Create a Wayfinder instance with the appropriate verification strategy
    const verificationStrategy = createVerificationStrategy({
      strategy: strategyType as VerificationOption,
      trustedGateways: [new URL(gateway)],
    }) as VerificationStrategy;

    // Use static routing to simplify the verification process
    const routingStrategy = new StaticRoutingStrategy({
      gateway,
    });

    // Create the Wayfinder instance with strict verification (will throw errors if verification fails)
    const wayfinder = new Wayfinder({
      fetch: fetchToUse,
      routingSettings: {
        strategy: routingStrategy,
      },
      telemetrySettings: {
        enabled: true,
        sampleRate: 1,
        clientName: 'verify-script',
        clientVersion: '1.0.0',
      },
      dataRetrievalStrategy: new ChunkDataRetrievalStrategy({
        fetch: fetchToUse,
      }),
      verificationSettings: {
        enabled: true,
        strategy: verificationStrategy,
        events: {
          onVerificationSucceeded: (
            event: WayfinderEvent['verification-succeeded'],
          ) => {
            console.log(
              `✅ Verification successful for transaction ${event.txId}`,
            );
          },
          onVerificationFailed: (
            error: WayfinderEvent['verification-failed'],
          ) => {
            console.error(`❌ Verification failed: ${error.message}`);
            if (error.cause) {
              console.error('Cause:', error.cause);
            }
          },
          onVerificationProgress: (
            event: WayfinderEvent['verification-progress'],
          ) => {
            const percentage = Math.round(
              (event.processedBytes / event.totalBytes) * 100,
            );
            console.log(
              `Verifying: ${percentage}% (${event.processedBytes}/${event.totalBytes} bytes)\r`,
            );
          },
        },
      },
      logger: {
        debug: (_message: string, _data: Record<string, any>) => {
          // noop
          // console.log('debug', _message, _data);
        },
        info: (message: string, data: Record<string, any>) => {
          console.log(message, data);
        },
        warn: (message: string, data: Record<string, any>) => {
          console.log(message, data);
        },
        error: (message: string, data: Record<string, any>) => {
          console.error(message, data);
        },
      },
    });

    // an example resolve url
    await wayfinder.resolveUrl({
      originalUrl: `ar://${txIdOrArns}`,
    });

    // Request the transaction data using the ar:// protocol
    const response = await wayfinder.request(`ar://${txIdOrArns}`);

    // Consume the response to ensure verification completes
    await response.text();

    // wait for 5 seconds so telemetry can flush
    await new Promise((resolve) => setTimeout(resolve, 5000));
  } catch (error) {
    console.error('Error during verification:');
    console.error(error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
