# WayFinder React Components

React components and hooks for the WayFinder project, making it easy to integrate AR.IO gateway routing in React applications.

## Installation

```bash
# Using npm
npm install @ar.io/wayfinder-react @ar.io/wayfinder-core

# Using yarn
yarn add @ar.io/wayfinder-react @ar.io/wayfinder-core
```

## Usage

### Initial Setup

```tsx
import { WayfinderProvider } from '@ar.io/wayfinder-react';
import { NetworkGatewaysProvider } from '@ar.io/wayfinder-core';
import { ARIO } from '@ar.io/sdk';

// Wrap your app with the WayfinderProvider
function App() {
  return (
    <WayfinderProvider
      // pass in the wayfinder options
      // https://github.com/ar-io/wayfinder/tree/alpha/packages/wayfinder-core#custom-configuration
      // by default, the provider will cache the gateways in local storage for 1 hour to avoid unnecessary network requests
      gatewaysProvider={new NetworkGatewaysProvider({
        ario: ARIO.mainnet(),
        limit: 10,
        sortBy: 'operatorStake',
      })}
    >
      <YourApp />
    </WayfinderProvider>
  );
}
```

## Hooks

### useWayfinderUrl

Get a dynamic URL for an existing `ar://` URL or legacy `arweave.net`/`arweave.dev` URL.

Example:

```tsx
import { useWayfinderUrl } from '@ar.io/wayfinder-react';

function WayfinderImage({ txId }: { txId: string }) {
  const { resolvedUrl, isLoading, error } = useWayfinderUrl({ txId });

  if (error) {
    return <p>Error resolving URL: {error.message}</p>;
  }

  if (isLoading) {
    return <p>Resolving URL...</p>;
  }

  return (
    <img src={resolvedUrl} alt={txId} />
  );
}
```

### useWayfinderRequest

Fetch the data via wayfinder, and optionally verify the data.

```tsx
import { useWayfinderRequest } from '@ar.io/wayfinder-react';

function WayfinderData({ txId }: { txId: string }) {
  const request = useWayfinderRequest();
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

  if (dataError) {
    return <p>Error loading data: {dataError.message}</p>;
  }

  if (dataLoading) {
    return <p>Loading data...</p>;
  }

  if (!data) {
    return <p>No data</p>;
  }

  return (
    <div>
      <pre>{data}</pre>
    </div>
  );
}
```
