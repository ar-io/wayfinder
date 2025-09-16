# Wayfinder React

React components and hooks for the WayFinder project, making it easy to integrate AR.IO gateway routing in React applications.

**Features:**

- React components for displaying and interacting with AR.IO gateways
- Hooks for gateway selection and routing
- Integration with the WayFinder core library

## Quick Start

### Installation

```bash
# Using npm
npm install @ar.io/wayfinder-react @ar.io/wayfinder-core

# Using yarn
yarn add @ar.io/wayfinder-react @ar.io/wayfinder-core
```

### Usage

```tsx
import {
  WayfinderProvider,
  useWayfinderRequest,
  useWayfinderUrl,
} from '@ar.io/wayfinder-react';
import { createWayfinderClient } from '@ar.io/wayfinder-core';
import { ARIO } from '@ar.io/sdk';

// Wrap your app with the WayfinderProvider
function App() {
  // Create a wayfinder client using the utility function
  const wayfinderClient = createWayfinderClient({
    ario: ARIO.mainnet(),
    gatewaySelection: 'top-ranked',
    routing: 'fastest',
    verification: 'hash',
    cache: { ttlSeconds: 3600 }, // cache for 1 hour
  });

  return (
    <WayfinderProvider wayfinder={wayfinderClient}>
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
import {
  WayfinderProvider,
  useWayfinderRequest,
  useWayfinderUrl,
} from '@ar.io/wayfinder-react';
import { createWayfinderClient } from '@ar.io/wayfinder-core';
import { ARIO } from '@ar.io/sdk';

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
