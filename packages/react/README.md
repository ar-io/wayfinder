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
  useWayfinderRequest,
  useWayfinderUrl,
} from '@ar.io/wayfinder-react';
import {
  NetworkGatewaysProvider,
  LocalStorageGatewaysProvider,
} from '@ar.io/wayfinder-core';
import { ARIO } from '@ar.io/sdk';

// Wrap your app with the provider
function App() {
  return (
    <WayfinderProvider
      // pass in the wayfinder options
      // https://github.com/ar-io/wayfinder/tree/alpha/packages/core#custom-configuration
      gatewaysProvider={new LocalStorageGatewaysProvider({ 
        ttlSeconds: 3600, // cache the gateways locally for 1 hour to avoid unnecessary network requests
        gatewaysProvider: new NetworkGatewaysProvider({ 
          ario: ARIO.mainnet() 
          limit: 10,
          sortBy: 'operatorStake',
        }),
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
  const request = useWayfinderRequest();
  const { resolvedUrl, isLoading: urlLoading, error: urlError } = useWayfinderUrl({ txId });

  // Use custom hooks for data fetching
  const [data, setData] = useState<any>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<Error | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setDataLoading(true);
        setDataError(null);
        // fetch the data for the txId using wayfinder
        const response = await request(`ar://${txId}`, {
          verificationSettings: {
            enabled: true, // enable verification on the request
            strict: true, // don't use the data if it's not verified
          },
        });
        const data = await response.arrayBuffer(); // or response.json() if you want to parse the data as JSON
        setData(data);
      } catch (error) {
        setDataError(error as Error);
      } finally {
        setDataLoading(false);
      }
    })();
  }, [request, txId]);

  return (
    <div>
      {urlLoading && <p>Resolving URL...</p>}
      {urlError && <p>Error resolving URL: {urlError.message}</p>}
      {resolvedUrl && <a href={resolvedUrl}>View on WayFinder</a>}
      <br />
      {dataLoading && <p>Loading data...</p>}
      {dataError && <p>Error loading data: {dataError.message}</p>}
      <pre>{data}</pre>
    </div>
  );
}
```
