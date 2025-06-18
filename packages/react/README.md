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
import {
  WayfinderProvider,
  useWayfinder,
  useWayfinderRequest,
  useWayfinderUrl,
  useWayfinderData,
} from '@ar.io/wayfinder-react';
import { NetworkGatewaysProvider } from '@ar.io/wayfinder-core';
import { ARIO } from '@ar.io/sdk';

// Wrap your app with the provider
function App() {
  return (
    <WayfinderProvider
      // pass in the wayfinder options
      // https://github.com/ar-io/wayfinder/tree/alpha/packages/core#custom-configuration
      gatewaysProvider={new NetworkGatewaysProvider({ 
        ario: ARIO.mainnet() 
        limit: 3,
        sortBy: 'operatorStake',
      })}
    >
      <YourApp />
    </WayfinderProvider>
  );
}

// Use components
function YourComponent() {
  const txId = 'your-transaction-id'; // Replace with actual txId
  
  // Use custom hooks for URL resolution and data fetching
  const { resolvedUrl, isLoading: urlLoading, error: urlError } = useWayfinderUrl({ url: `ar://${txId}` });
  const { data: txData, isLoading: dataLoading, error: dataError } = useWayfinderData({ url: `ar://${txId}` });

  return (
    <div>
      {urlLoading && <p>Resolving URL...</p>}
      {urlError && <p>Error resolving URL: {urlError.message}</p>}
      {resolvedUrl && <a href={resolvedUrl}>View on WayFinder</a>}
      <br />
      {dataLoading && <p>Loading data...</p>}
      {dataError && <p>Error loading data: {dataError.message}</p>}
      <pre>{txData}</pre>
    </div>
  );
}
```
