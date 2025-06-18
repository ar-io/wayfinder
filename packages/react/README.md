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
} from '@ar.io/wayfinder-react';
import { NetworkGatewaysProvider } from '@ar.io/wayfinder-core';
import { ARIO } from '@ar.io/sdk';

// Wrap your app with the provider
function App() {
  return (
    <WayfinderProvider
      // pass in the wayfinder options
      // https://github.com/ar-io/wayfinder/tree/alpha/packages/core#custom-configuration
      gatewaysProvider={new NetworkGatewaysProvider({ ario: ARIO.mainnet() })}
    >
      <YourApp />
    </WayfinderProvider>
  );
}

// Use components
function YourComponent() {
  const { wayfinder } = useWayfinder();
  const [txData, setTxData] = useState<string | null>(null);

  // useMemo to get a resolution URL for a given txId
  const wayfinderUrl = useMemo(() => wayfinder.resolveUrl(`ar://${txId}`), [txId, wayfinder]);

  // request some data from arweave via wayfinder
  useEffect(() => {
    (async () => {
      const res = await wayfinder.request(`ar://${txId}`);
      setTxData(await res.text());
    })();
  }, [txId, wayfinder]);

  return (
    <div>
      <a href={wayfinderUrl}>View on WayFinder</a>
      <pre>{txData}</pre>
    </div>
  );
}
```
