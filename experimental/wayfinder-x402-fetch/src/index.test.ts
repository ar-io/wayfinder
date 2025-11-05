/**
 * Test for x402-fetch integration with Wayfinder
 *
 * This test demonstrates how the createX402Fetch function handles 402 Payment Required responses
 * by using a dummy EVM wallet and stubbed fetch responses.
 */

import assert from 'node:assert';
import { beforeEach, describe, mock, test } from 'node:test';
import { privateKeyToAccount } from 'viem/accounts';
import { Signer } from 'x402-fetch';
import { createX402Fetch } from './index.js';

describe('createX402Fetch', () => {
  // Create a dummy EVM account for testing
  const dummyPrivateKey =
    '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  const dummyAccount = privateKeyToAccount(dummyPrivateKey);

  // Mock wallet client that implements the basic Signer interface
  let mockWalletClient: Signer;

  beforeEach(() => {
    // @ts-expect-error - Mock implementation
    mockWalletClient = {
      account: dummyAccount,
      signMessage: mock.fn(async () => '0xmocksignature'),
      getChainId: mock.fn(async () => 1), // Ethereum mainnet
    } as Signer;
  });

  test('should handle regular requests (non-402 responses)', async () => {
    // Mock fetch that returns a successful response
    const mockFetch = mock.fn(
      async () =>
        new Response('Success!', {
          status: 200,
          statusText: 'OK',
        }),
    );

    const x402Fetch = createX402Fetch({
      fetch: mockFetch,
      walletClient: mockWalletClient,
    });

    const response = await x402Fetch('https://example.com/data', {
      method: 'GET',
    });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), 'Success!');
    assert.strictEqual(mockFetch.mock.callCount(), 1);
  });

  test('should create a wrapped fetch function', async () => {
    // Simple test to verify the wrapper function is created correctly
    const mockFetch = mock.fn(
      async () => new Response('Success!', { status: 200 }),
    );

    const x402Fetch = createX402Fetch({
      fetch: mockFetch,
      walletClient: mockWalletClient,
    });

    // Verify it's a function
    assert.strictEqual(typeof x402Fetch, 'function');

    // Verify it can make a basic call
    const response = await x402Fetch('https://example.com/data');
    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), 'Success!');

    // Verify the underlying fetch was called
    assert.strictEqual(mockFetch.mock.callCount(), 1);
  });

  test('should reject payments exceeding maxValue', async () => {
    // Mock fetch that returns 402 with high payment amount
    const mockFetch = mock.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: 'Payment Required',
            message: 'This resource requires payment',
          }),
          {
            status: 402,
            statusText: 'Payment Required',
            headers: {
              'content-type': 'application/json',
              'www-authenticate':
                'x402-payment amount=5000000000000000000 chainId=1 token=0x0000000000000000000000000000000000000000 receiver=0x742d35Cc6634C0532925a3b8D8C66E44A8b7B75e',
            },
          },
        ),
    );

    const x402Fetch = createX402Fetch({
      fetch: mockFetch,
      walletClient: mockWalletClient,
      maxValue: BigInt('1000000000000000000'), // 1 ETH max (less than required 5 ETH)
    });

    // Should throw an error when payment exceeds maxValue
    await assert.rejects(
      x402Fetch('https://expensive.example.com/data'),
      /Error/,
    );

    assert.strictEqual(mockFetch.mock.callCount(), 1);
  });

  test('should use globalThis.fetch as default when no fetch provided', () => {
    const x402Fetch = createX402Fetch({
      walletClient: mockWalletClient,
    });

    // The function should be created successfully
    assert.strictEqual(typeof x402Fetch, 'function');
  });

  test('should preserve original request properties', async () => {
    const mockFetch = mock.fn(
      async () => new Response('Success!', { status: 200 }),
    );

    const x402Fetch = createX402Fetch({
      fetch: mockFetch,
      walletClient: mockWalletClient,
    });

    const requestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Custom-Header': 'custom-value',
      },
      body: JSON.stringify({ test: 'data' }),
    };

    await x402Fetch('https://api.example.com/endpoint', requestInit);

    assert.strictEqual(mockFetch.mock.callCount(), 1);

    // Verify the call was made with correct parameters
    const calls = mockFetch.mock.calls;
    if (calls.length > 0) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any
      const callArgs: any = calls[0]; // @ts-ignore
      if (callArgs && callArgs.arguments.length > 0) {
        assert.strictEqual(
          callArgs.arguments[0],
          'https://api.example.com/endpoint',
        );
        if (
          callArgs.arguments.length > 1 &&
          callArgs.arguments[1] !== undefined
        ) {
          const actualInit = callArgs.arguments[1] as RequestInit;
          assert.strictEqual(actualInit.method, 'POST');
          assert.strictEqual(actualInit.body, JSON.stringify({ test: 'data' }));
          assert.ok(actualInit.headers);
        }
      }
    }
  });
});
