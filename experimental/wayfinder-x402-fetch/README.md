# wayfinder-x402-fetch

A simple wrapper for [x402-fetch](https://github.com/ar-io/x402-fetch) that provides payment-aware fetch functionality for Wayfinder. This package handles 402 Payment Required responses automatically using the x402 protocol.

## Installation

```bash
npm install @ar.io/wayfinder-x402-fetch
```

## Usage

### Basic Usage

```typescript
import { createX402Fetch } from '@ar.io/wayfinder-x402-fetch';
import { Wayfinder } from '@ar.io/wayfinder-core';

// Create a payment-enabled fetch function
const x402Fetch = createX402Fetch({
  walletClient: myWalletClient, // Your x402-compatible wallet
  fetch: globalThis.fetch, // Optional: custom fetch function
  maxValue: 1000n // Optional: maximum payment amount
});

// Supply it to Wayfinder as the fetch implementation
const wayfinder = new Wayfinder({
  fetch: x402Fetch,
  verificationSettings: { enabled: false }
});

// Use normally - payments are handled automatically
const response = await wayfinder.request('ar://premium-content-txid');
```

## What This Package Does

This is a thin wrapper around x402-fetch that:
1. Takes x402-fetch configuration
2. Calls `wrapFetchWithPayment()` from x402-fetch
3. Returns a fetch function compatible with Wayfinder

The returned function automatically handles:
- 402 Payment Required responses
- Payment credential generation
- Request retry with payment headers

## Configuration

The `createX402Fetch` function accepts:

- `walletClient` (required): A Signer or MultiNetworkSigner from x402-fetch
- `fetch` (optional): Custom fetch function to wrap (defaults to `globalThis.fetch`)
- `maxValue` (optional): Maximum payment amount in wei

For detailed x402-fetch configuration options, see the [x402-fetch documentation](https://github.com/ar-io/x402-fetch).

## Testing

Run the tests to see x402-fetch integration in action:

```bash
npm test
```

This will demonstrate:
- Regular fetch requests (non-402 responses)
- 402 Payment Required handling with automatic payment
- Payment rejection when exceeding maxValue limits

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](../../LICENSE) for details.
