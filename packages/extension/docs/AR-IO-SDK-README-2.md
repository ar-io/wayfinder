## Arweave Name Tokens (ANT's)

The ANT client class exposes APIs relevant to compliant Arweave Name Token processes. It can be configured to use any process ID that adheres to the ANT process spec. You must provide either a custom process data provider or a processId to the ANT class constructor to use.

### ANT APIs

#### `init({ processId, signer })`

Factory function to that creates a read-only or writeable client. By providing a `signer` additional write APIs that require signing, like `setRecord` and `transfer` are available. By default, a read-only client is returned and no write APIs are available.

```typescript
// in a browser environment with ArConnect
const ant = ANT.init({
  signer: new ArConnectSigner(window.arweaveWallet, Arweave.init({})),
  processId: 'bh9l1cy0aksiL_x9M359faGzM_yjralacHIUo8_nQXM'
});

// in a node environment
const ant = ANT.init({
  signer: new ArweaveSigner(JWK),
  processId: 'bh9l1cy0aksiL_x9M359faGzM_yjralacHIUo8_nQXM'
});

```

#### `getInfo()`

Retrieves the information of the ANT process.

```typescript
const info = await ant.getInfo();
```

<details>
  <summary>Output</summary>

```json
{
  "name": "ArDrive",
  "ticker": "ANT-ARDRIVE",
  "description": "This is the ANT for the ArDrive decentralized web app.",
  "keywords": ["File-sharing", "Publishing", "dApp"],
  "owner": "QGWqtJdLLgm2ehFWiiPzMaoFLD50CnGuzZIPEdoDRGQ"
}
```

</details>

#### `getHandlers()`

Retrieves the handlers supported on the ANT

```typescript
const handlers = await ant.getHandlers();
```

<details>
  <summary>Output</summary>

```json
[
  "_eval",
  "_default",
  "transfer",
  "balance",
  "balances",
  "totalSupply",
  "info",
  "addController",
  "removeController",
  "controllers",
  "setRecord",
  "removeRecord",
  "record",
  "records",
  "setName",
  "setTicker",
  "initializeState",
  "state"
]
```

</details>

#### `getState()`

Retrieves the state of the ANT process.

```typescript
const state = await ant.getState();
```

<details>
  <summary>Output</summary>

```json
{
  "TotalSupply": 1,
  "Balances": {
    "98O1_xqDLrBKRfQPWjF5p7xZ4Jx6GM8P5PeJn26xwUY": 1
  },
  "Controllers": [],
  "Records": {
    "v1-0-0_whitepaper": {
      "transactionId": "lNjWn3LpyhKC95Kqe-x8X2qgju0j98MhucdDKK85vc4",
      "ttlSeconds": 900
    },
    "@": {
      "transactionId": "2rMLb2uHAyEt7jSu6bXtKx8e-jOfIf7E-DOgQnm8EtU",
      "ttlSeconds": 3600
    },
    "whitepaper": {
      "transactionId": "lNjWn3LpyhKC95Kqe-x8X2qgju0j98MhucdDKK85vc4",
      "ttlSeconds": 900
    }
  },
  "Initialized": true,
  "Ticker": "ANT-AR-IO",
  "Description": "A friendly description for this ANT.",
  "Keywords": ["keyword1", "keyword2", "keyword3"],
  "Logo": "Sie_26dvgyok0PZD_-iQAFOhOd5YxDTkczOLoqTTL_A",
  "Denomination": 0,
  "Name": "AR.IO Foundation",
  "Owner": "98O1_xqDLrBKRfQPWjF5p7xZ4Jx6GM8P5PeJn26xwUY"
}
```

</details>

#### `getOwner()`

Returns the owner of the configured ANT process.

```typescript
const owner = await ant.getOwner();
```

<details>
  <summary>Output</summary>

```json
"ccp3blG__gKUvG3hsGC2u06aDmqv4CuhuDJGOIg0jw4"
```

</details>

#### `getControllers()`

Returns the controllers of the configured ANT process.

```typescript
const controllers = await ant.getControllers();
```

<details>
  <summary>Output</summary>

```json
["ccp3blG__gKUvG3hsGC2u06aDmqv4CuhuDJGOIg0jw4"]
```

</details>

#### `getRecords()`

Returns all records on the configured ANT process, including the required `@` record that resolve connected ArNS names.

```typescript
const records = await ant.getRecords();
```

<details>
  <summary>Output</summary>

```json
{
  "@": {
    "transactionId": "UyC5P5qKPZaltMmmZAWdakhlDXsBF6qmyrbWYFchRTk",
    "ttlSeconds": 3600
  },
  "zed": {
    "transactionId": "-k7t8xMoB8hW482609Z9F4bTFMC3MnuW8bTvTyT8pFI",
    "ttlSeconds": 900
  },

  "ardrive": {
    "transactionId": "-cucucachoodwedwedoiwepodiwpodiwpoidpwoiedp",
    "ttlSeconds": 900
  }
}
```

</details>

#### `transfer({ target })`

Transfers ownership of the ANT to a new target address. Target MUST be an Arweave address.

_Note: Requires `signer` to be provided on `ANT.init` to sign the transaction._

```typescript
const { id: txId } = await ant.transfer(
  { target: 'aGzM_yjralacHIUo8_nQXMbh9l1cy0aksiL_x9M359f' },
  // optional additional tags
  { tags: [{ name: 'App-Name', value: 'My-Awesome-App' }] },
);
```

#### `setController({ controller })`

Adds a new controller to the list of approved controllers on the ANT. Controllers can set records and change the ticker and name of the ANT process.

_Note: Requires `signer` to be provided on `ANT.init` to sign the transaction._

```typescript
const { id: txId } = await ant.setController(
  { controller: 'aGzM_yjralacHIUo8_nQXMbh9l1cy0aksiL_x9M359f' },
  // optional additional tags
  { tags: [{ name: 'App-Name', value: 'My-Awesome-App' }] },
);
```

#### `removeController({ controller })`

Removes a controller from the list of approved controllers on the ANT.

_Note: Requires `signer` to be provided on `ANT.init` to sign the transaction._

```typescript
const { id: txId } = await ant.removeController(
  { controller: 'aGzM_yjralacHIUo8_nQXMbh9l1cy0aksiL_x9M359f' },
  // optional additional tags
  { tags: [{ name: 'App-Name', value: 'My-Awesome-App' }] },
);
```

#### `setBaseNameRecord({ transactionId, ttlSeconds })`

Adds or updates the base name record for the ANT. This is the top level name of the ANT (e.g. ardrive.ar.io)

_Note: Requires `signer` to be provided on `ANT.init` to sign the transaction._

```typescript
// get the ant for the base name
const arnsRecord = await ario.getArNSRecord({ name: 'ardrive' });
const ant = await ANT.init({ processId: arnsName.processId });
const { id: txId } = await ant.setBaseNameRecord({
  transactionId: '432l1cy0aksiL_x9M359faGzM_yjralacHIUo8_nQXM',
  ttlSeconds: 3600,
});

// ardrive.ar.io will now resolve to the provided 432l1cy0aksiL_x9M359faGzM_yjralacHIUo8_nQXM transaction id
```

#### `setUndernameRecord({ undername, transactionId, ttlSeconds })`

Adds or updates an undername record for the ANT. An undername is appended to the base name of the ANT (e.g. dapp_ardrive.ar.io)

_Note: Requires `signer` to be provided on `ANT.init` to sign the transaction._

> Records, or `undernames` are configured with the `transactionId` - the arweave transaction id the record resolves - and `ttlSeconds`, the Time To Live in the cache of client applications.

```typescript
const arnsRecord = await ario.getArNSRecord({ name: 'ardrive' });
const ant = await ANT.init({ processId: arnsName.processId });
const { id: txId } = await ant.setUndernameRecord(
  {
    undername: 'dapp',
    transactionId: '432l1cy0aksiL_x9M359faGzM_yjralacHIUo8_nQXM',
    ttlSeconds: 900,
  },
  // optional additional tags
  { tags: [{ name: 'App-Name', value: 'My-Awesome-App' }] },
);

// dapp_ardrive.ar.io will now resolve to the provided 432l1cy0aksiL_x9M359faGzM_yjralacHIUo8_nQXM transaction id
```

#### `removeUndernameRecord({ undername })`

Removes an undername record from the ANT process.

_Note: Requires `signer` to be provided on `ANT.init` to sign the transaction._

```typescript
const { id: txId } = await ant.removeUndernameRecord(
  { undername: 'dapp' },
  // optional additional tags
  { tags: [{ name: 'App-Name', value: 'My-Awesome-App' }] },
);

// dapp_ardrive.ar.io will no longer resolve to the provided transaction id
```

#### `setRecord({ undername, transactionId, ttlSeconds })`

> [!WARNING]
> Deprecated: Use `setBaseNameRecord` or `setUndernameRecord` instead.

Adds or updates a record for the ANT process. The `undername` parameter is used to specify the record name. Use `@` for the base name record.

_Note: Requires `signer` to be provided on `ANT.init` to sign the transaction._

> Records, or `undernames` are configured with the `transactionId` - the arweave transaction id the record resolves - and `ttlSeconds`, the Time To Live in the cache of client applications.

```typescript
const { id: txId } = await ant.setRecord(
  {
    undername: '@',
    transactionId: '432l1cy0aksiL_x9M359faGzM_yjralacHIUo8_nQXM'
    ttlSeconds: 3600
  },
  // optional additional tags
  { tags: [{ name: 'App-Name', value: 'My-Awesome-App' }] },
);
```

#### `removeRecord({ undername })`

> [!WARNING]
> Deprecated: Use `removeUndernameRecord` instead.

Removes a record from the ANT process.

_Note: Requires `signer` to be provided on `ANT.init` to sign the transaction._

```typescript
const arnsRecord = await ario.getArNSRecord({ name: 'ardrive' });
const ant = await ANT.init({ processId: arnsName.processId });
const { id: txId } = await ant.removeRecord(
  { undername: 'dapp' },
  // optional additional tags
  { tags: [{ name: 'App-Name', value: 'My-Awesome-App' }] },
);

// dapp_ardrive.ar.io will no longer resolve to the provided transaction id
```

#### `setName({ name })`

Sets the name of the ANT process.

_Note: Requires `signer` to be provided on `ANT.init` to sign the transaction._

```typescript
const { id: txId } = await ant.setName(
  { name: 'My ANT' },
  // optional additional tags
  { tags: [{ name: 'App-Name', value: 'My-Awesome-App' }] },
);
```

#### `setTicker({ ticker })`

Sets the ticker of the ANT process.

_Note: Requires `signer` to be provided on `ANT.init` to sign the transaction._

```typescript
const { id: txId } = await ant.setTicker(
  { ticker: 'ANT-NEW-TICKER' },
  // optional tags
  { tags: [{ name: 'App-Name', value: 'My-Awesome-App' }] },
);
```

#### `setDescription({ description })`

Sets the description of the ANT process.

_Note: Requires `signer` to be provided on `ANT.init` to sign the transaction._

```typescript
const { id: txId } = await ant.setDescription(
  { description: 'A friendly description of this ANT' },
  // optional tags
  { tags: [{ name: 'App-Name', value: 'My-Awesome-App' }] },
);
```

#### `setKeywords({ keywords })`

Sets the keywords of the ANT process.

_Note: Requires `signer` to be provided on `ANT.init` to sign the transaction._

```typescript
const { id: txId } = await ant.setDescription(
  { keywords: ['Game', 'FPS', 'AO'] },
  // optional tags
  { tags: [{ name: 'App-Name', value: 'My-Awesome-App' }] },
);
```

#### `getLogo()`

Returns the TX ID of the logo set for the ANT.

```typescript
const logoTxId = await ant.getLogo();
```

#### `setLogo({ txId })`

Sets the Logo of the ANT - logo should be an Arweave transaction ID.

_Note: Requires `signer` to be provided on `ANT.init` to sign the transaction._

```typescript
const { id: txId } = await ant.setLogo(
  { txId: 'U7RXcpaVShG4u9nIcPVmm2FJSM5Gru9gQCIiRaIPV7f' },
  // optional tags
  { tags: [{ name: 'App-Name', value: 'My-Awesome-App' }] },
);
```

#### `releaseName({ name, arioProcessId })`

Releases a name from the current owner and makes it available for purchase on the ARIO contract. The name must be permanently owned by the releasing wallet. If purchased within the recently returned name period (14 epochs), 50% of the purchase amount will be distributed to the ANT owner at the time of release. If no purchases in the recently returned name period, the name can be reregistered by anyone for the normal fee.

_Note: Requires `signer` to be provided on `ANT.init` to sign the transaction._

```typescript
const { id: txId } = await ant.releaseName({
  name: 'permalink',
  arioProcessId: ARIO_MAINNET_PROCESS_ID, // releases the name owned by the ANT and sends it to recently returned names on the ARIO contract
});
```

#### `reassignName({ name, arioProcessId, antProcessId })`

Reassigns a name to a new ANT. This can only be done by the current owner of the ANT.

_Note: Requires `signer` to be provided on `ANT.init` to sign the transaction._

```typescript
const { id: txId } = await ant.reassignName({
  name: 'ardrive',
  arioProcessId: ARIO_MAINNET_PROCESS_ID,
  antProcessId: NEW_ANT_PROCESS_ID, // the new ANT process id that will take over ownership of the name
});
```

#### `approvePrimaryNameRequest({ name, address, arioProcessId })`

Approves a primary name request for a given name or address.

_Note: Requires `signer` to be provided on `ANT.init` to sign the transaction._

```typescript
const { id: txId } = await ant.approvePrimaryNameRequest({
  name: 'arns',
  address: 't4Xr0_J4Iurt7caNST02cMotaz2FIbWQ4Kbj616RHl3', // must match the request initiator address
  arioProcessId: ARIO_MAINNET_PROCESS_ID, // the ARIO process id to use for the request
});
```

#### `removePrimaryNames({ names, arioProcessId, notifyOwners })`

Removes primary names from the ANT process.

_Note: Requires `signer` to be provided on `ANT.init` to sign the transaction._

```typescript
const { id: txId } = await ant.removePrimaryNames({
  names: ['arns', 'test_arns'], // any primary names associated with a base name controlled by this ANT will be removed
  arioProcessId: ARIO_MAINNET_PROCESS_ID,
  notifyOwners: true, // if true, the owners of the removed names will be send AO messages to notify them of the removal
});
```

### Configuration

ANT clients can be configured to use custom AO process. Refer to [AO Connect] for more information on how to configure the AO process to use specific AO infrastructure.

```typescript

const ant = ANT.init({
  process: new AoProcess({
    processId: 'ANT_PROCESS_ID'
    ao: connect({
      MODE: 'legacy',
      MU_URL: 'https://mu-testnet.xyz',
      CU_URL: 'https://cu-testnet.xyz',
      GRAPHQL_URL: 'https://arweave.net/graphql',
      GATEWAY_URL: 'https://arweave.net',
    })
  })
});
```

## Token Conversion

The ARIO process stores all values as mARIO (milli-ARIO) to avoid floating-point arithmetic issues. The SDK provides an `ARIOToken` and `mARIOToken` classes to handle the conversion between ARIO and mARIO, along with rounding logic for precision.

**All process interactions expect values in mARIO. If numbers are provided as inputs, they are assumed to be in raw mARIO values.**

### Converting ARIO to mARIO

```typescript
import { ARIOToken, mARIOToken } from '@ar.io/sdk';

const arioValue = 1;
const mARIOValue = new ARIOToken(arioValue).toMARIO();

const mARIOValue = 1_000_000;
const arioValue = new mARIOToken(mARIOValue).toARIO();
```

## Logging

The library uses the [Winston] logger for node based projects, and `console` logger for web based projects by default. You can configure the log level via `setLogLevel()` API. Alternatively you can set a custom logger as the default logger so long as it satisfes the `ILogger` interface.

```typescript
import { Logger } from '@ar.io/sdk';

// set the log level
Logger.default.setLogLevel('debug');

// provide your own logger
Logger.default = winston.createLogger({ ...loggerConfigs }); // or some other logger that satisifes ILogger interface
```

## Pagination

Certain APIs that could return a large amount of data are paginated using cursors. The SDK uses the `cursor` pattern (as opposed to pages) to better protect against changing data while paginating through a list of items. For more information on pagination strategies refer to [this article](https://www.getknit.dev/blog/api-pagination-best-practices#api-pagination-techniques-).

Paginated results include the following properties:

- `items`: the list of items on the current request, defaulted to 100 items.
- `nextCursor`: the cursor to use for the next batch of items. This is `undefined` if there are no more items to fetch.
- `hasMore`: a boolean indicating if there are more items to fetch. This is `false` if there are no more items to fetch.
- `totalItems`: the total number of items available. This may change as new items are added to the list, only use this for informational purposes.
- `sortBy`: the field used to sort the items, by default this is `startTimestamp`.
- `sortOrder`: the order used to sort the items, by default this is `desc`.

To request all the items in a list, you can iterate through the list using the `nextCursor` until `hasMore` is `false`.

```typescript
let hasMore = true;
let cursor: string | undefined;
const gateaways = [];
while (hasMore) {
  const page = await ario.getGateways({ limit: 100, cursor });
  gateaways.push(...items);
  cursor = page.nextCursor;
  hasMore = page.hasMore;
}
```

## Resources

### Bundling

For [ANS-104] bundling compatible with ar.io gateways, we recommend using [turbo-sdk](https://github.com/ardriveapp/turbo-sdk). Turbo SDK provides efficient and reliable methods for creating and uploading data bundles to the Arweave network, which are fully compatible with ar.io gateways. Turbo supports fiat and crypto bundling and uploading with a focus on ease of use and reliability.

### AR.IO Gateways

### Running a Gateway

To run your own ar.io gateway, you can refer to the following resources:

- [ar-io-node repository]: This repository contains the source code and instructions for setting up and running an ar.io gateway node.
- [ar.io Gateway Documentation]: This comprehensive guide provides detailed information on gateway setup, configuration, and management.

Running your own gateway allows you to participate in the ar.io network, serve Arweave data, and potentially earn rewards. Make sure to follow the official documentation for the most up-to-date and accurate information on gateway operation.

### AO

This library integrates with [AO], a decentralized compute platform built on Arweave. We utilize [AO Connect] to interact with AO processes and messages. This integration allows for seamless communication with the AO network, enabling developers to leverage decentralized computation and storage capabilities in their applications.

For more information on how to use AO and AO Connect within this library, please refer to our documentation and examples.

## Developers

### Requirements

- `node` >= 18.0.0
- `npm` or `yarn`
- `docker` (recommended for testing)

### Setup & Build

- `nvm use` - use the correct node version
- `yarn install` - installs dependencies
- `yarn build` - builds web/node/bundled outputs

### Testing

- `yarn test` - runs e2e tests and unit tests
- `yarn test:e2e` - runs e2e tests
- `yarn test:unit` - runs unit tests
- `yarn example:web` - opens up the example web page
- `yarn example:cjs` - runs example CJS node script
- `yarn example:esm` - runs example ESM node script
- `yarn example:vite` - runs example Vite web page

### Linting & Formatting

- `yarn lint:check` - checks for linting errors
- `yarn lint:fix` - fixes linting errors
- `yarn format:check` - checks for formatting errors
- `yarn format:fix` - fixes formatting errors

### Architecture

- Code to interfaces.
- Prefer type safety over runtime safety.
- Prefer composition over inheritance.
- Prefer integration tests over unit tests.

For more information on how to contribute, please see [CONTRIBUTING.md].

<!-- ADD ALL LINK REFERENCES BELOW -->

[ar.io]: https://ar.io
[permaweb/aoconnect]: https://github.com/permaweb/aoconnect
[package.json]: ./package.json
[examples]: ./examples
[examples/webpack]: ./examples/webpack
[examples/vite]: ./examples/vite
[CONTRIBUTING.md]: ./CONTRIBUTING.md
[AO Connect]: https://github.com/permaweb/ao/tree/main/connect
[ARIO Testnet Process]: https://www.ao.link/#/entity/agYcCFJtrMG6cqMuZfskIkFTGvUPddICmtQSBIoPdiA
[ARIO Network Spec]: https://github.com/ar-io/ar-io-network-process?tab=readme-ov-file#contract-spec
[Winston]: https://www.npmjs.com/package/winston
[AO]: https://github.com/permaweb/ao
[ar-io-node repository]: https://github.com/ar-io/ar-io-node
[ar.io Gateway Documentation]: https://docs.ar.io/gateways/ar-io-node/overview/
[ANS-104]: https://github.com/ArweaveTeam/arweave-standards/blob/master/ans/ANS-104.md
[ar-io-testnet-faucet]: https://github.com/ar-io/ar-io-testnet-faucet?tab=readme-ov-file#asynchronous-workflow
