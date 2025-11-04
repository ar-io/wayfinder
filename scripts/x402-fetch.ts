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

// Get transaction ID from command line arguments
const txId = process.argv[2];
if (!txId) {
  console.error('Usage: node fetch-data.ts <transaction-id>');
  process.exit(1);
}

const gatewayUrlString = process.argv[3] || 'https://permagate.io';

if (!gatewayUrlString) {
  console.error('Usage: node fetch-data.ts <transaction-id> [gateway-url]');
  process.exit(1);
}

const gatewayUrl = new URL(gatewayUrlString);

// Create a wallet client (using your private key)
const privateKey = process.env.X402_TEST_PRIVATE_KEY as
  | `0x${string}`
  | undefined;
if (privateKey === undefined) {
  throw new Error('X402_TEST_PRIVATE_KEY environment variable is not set');
}
const account = privateKeyToAccount(privateKey);

const x402Fetch = createX402Fetch({
  walletClient: account,
});

x402Fetch(`${gatewayUrl}/${txId}`, { method: 'GET' })
  .then(async (response) => {
    if (response.status !== 200) {
      const details = await response.json();
      throw new Error(
        `Request failed with status ${response.status}: ${JSON.stringify(details)}`,
      );
    }

    // print out all the headers
    console.log('\n-----Response Headers-----');
    console.log('status:', response.status);
    console.log('statusText:', response.statusText);
    response.headers.forEach((value, name) => {
      console.log(`${name}: ${value}`);
    });
  })
  .catch((error) => {
    console.error(error);
  });
