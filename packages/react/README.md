# WayFinder React Components

React components and hooks for the WayFinder project, making it easy to integrate AR.IO gateway routing in React applications.

## Features

- React components for displaying and interacting with AR.IO gateways
- Hooks for gateway selection and routing
- Integration with the WayFinder core library

## Installation

```bash
# Using npm
npm install @ar.io/wayfinder-react @ar.io/wayfinder-core

# Using yarn
yarn add @ar.io/wayfinder-react @ar.io/wayfinder-core
```

## Usage

```jsx
import { WayfinderProvider, ArweaveLink, useWayfinder } from '@ar.io/wayfinder-react';

// Wrap your app with the provider
function App() {
  return (
    <WayfinderProvider>
      <YourApp />
    </WayfinderProvider>
  );
}

// Use components
function YourComponent() {
  return (
    <div>
      <ArweaveLink txId="your-tx-id">View on Arweave</ArweaveLink>
    </div>
  );
}

// Use hooks
function GatewaySelector() {
  const { selectGateway, currentGateway } = useWayfinder();
  
  return (
    <div>
      <p>Current Gateway: {currentGateway.domain}</p>
      <button onClick={() => selectGateway()}>Change Gateway</button>
    </div>
  );
}
```

## License

AGPL-3.0-only
