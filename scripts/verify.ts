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
import { ARIO } from '@ar.io/sdk';
import { NetworkGatewaysProvider } from '../packages/core/src/gateways/network.js';
import { StaticRoutingStrategy } from '../packages/core/src/routing/static.js';
import {
  VerificationStrategy,
  WayfinderEvent,
} from '../packages/core/src/types.js';
import { DataRootVerificationStrategy } from '../packages/core/src/verification/data-root-verifier.js';
import { HashVerificationStrategy } from '../packages/core/src/verification/hash-verifier.js';
import { SignatureVerificationStrategy } from '../packages/core/src/verification/signature-verifier.js';
import { Wayfinder } from '../packages/core/src/wayfinder.js';

// Define the verification strategies
type VerificationStrategyType = 'data-root' | 'hash' | 'signature';

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const txId = args[0];
  const strategyType = (args[1] || 'hash') as VerificationStrategyType;
  const gateway = args[2] || 'https://permagate.io';

  if (!txId) {
    console.error('Usage: node verify.js <tx-id> [verification-strategy]');
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

  return { txId, strategyType, gateway };
}

// Create the appropriate verification strategy based on the input
function createVerificationStrategy(
  strategyType: VerificationStrategyType,
  gateway: string,
): VerificationStrategy {
  // Use permagate.io as the trusted provider for verification
  const trustedGateway = new URL(gateway);

  switch (strategyType) {
    case 'data-root':
      return new DataRootVerificationStrategy({
        trustedGateways: [trustedGateway],
      });
    case 'hash':
      return new HashVerificationStrategy({
        trustedGateways: [trustedGateway],
      });
    case 'signature':
      return new SignatureVerificationStrategy({
        trustedGateways: [trustedGateway],
      });
    default:
      throw new Error(`Unknown verification strategy: ${strategyType}`);
  }
}

async function main() {
  const { txId, strategyType, gateway } = parseArgs();

  console.log(
    `Verifying transaction ${txId} using ${strategyType} verification...`,
  );

  try {
    // Create a Wayfinder instance with the appropriate verification strategy
    const verificationStrategy = createVerificationStrategy(
      strategyType,
      gateway,
    );

    // Set up a static gateway provider with a known gateway
    const gatewaysProvider = new NetworkGatewaysProvider({
      ario: ARIO.mainnet(),
      sortBy: 'operatorStake',
      sortOrder: 'desc',
      limit: 10,
    });

    // Use static routing to simplify the verification process
    const routingStrategy = new StaticRoutingStrategy({
      gateway: 'https://permagate.io',
    });

    // Create the Wayfinder instance with strict verification (will throw errors if verification fails)
    const wayfinder = new Wayfinder({
      gatewaysProvider,
      routingSettings: {
        strategy: routingStrategy,
      },
      telemetrySettings: {
        enabled: true,
        sampleRate: 1,
        serviceName: 'verify-script',
      },
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
          console.log('debug', _message, _data);
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

    // Request the transaction data using the ar:// protocol
    const response = await wayfinder.request(`ar://${txId}`);

    // Consume the response to ensure verification completes
    await response.text();

    // wait for 15 seconds so telemetry can flush
    await new Promise((resolve) => setTimeout(resolve, 15000));
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
