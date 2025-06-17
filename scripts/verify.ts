/**
 * WayFinder
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc. All Rights Reserved.
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
import { StaticGatewaysProvider } from '../packages/core/src/gateways/static.js';
import { StaticRoutingStrategy } from '../packages/core/src/routing/static.js';
import { DataRootVerificationStrategy } from '../packages/core/src/verification/data-root-verifier.js';
import { HashVerificationStrategy } from '../packages/core/src/verification/hash-verifier.js';
import { SignatureVerificationStrategy } from '../packages/core/src/verification/signature-verifier.js';
import { Wayfinder, WayfinderEvent } from '../packages/core/src/wayfinder.js';
import { Logger } from '../packages/core/src/wayfinder.js';

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
) {
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
    const gatewaysProvider = new StaticGatewaysProvider({
      gateways: ['https://permagate.io'],
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
