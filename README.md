# WayFinder

WayFinder is a set of tools for intelligently routing users to optimal AR.IO gateways, ensuring streamlined access to the permaweb on Arweave.

## Packages

This monorepo contains the following packages:


- **[@ar.io/wayfinder](./packages/core)**: Core library with routing functionality
- **[@ar.io/wayfinder-react](./packages/react)**: React components for WayFinder
- **[@ar.io/wayfinder-extension](./packages/extension)**: Chrome extension for WayFinder

## What is it?

WayFinder (beta) is a simple, open source, routing protocol for the permaweb. It is designed to leverage the ar.io network to route users to the most optimal gateway for a given request.

## Who is it built for?

- Anyone who wants to browse the Permaweb. Since no wallet is needed, the user does not have to have ever touched tokens or even uploaded data.
- Developers who want to integrate ar:// protocol. Wayfinder shows how the ar:// protocol could be leveraged along with how to discover gateways on the ar.io network.


## Want to learn more?

Join our discord for more information about WayFinder or how to contribute: https://discord.gg/zAZ8p9ARqC

## Developers

### Requirements

- `node` - v18+
- `yarn` - v1.4

### Dependencies

Dependencies should be installed using Yarn

```bash
yarn install
```

### Build

```bash
# Build all packages
yarn build
```

### Loading the Extension into Chrome

To load the bundled app as an extension in Chrome:

1. Run `yarn build` to create a fresh `dist` directory in the extension package
2. Navigate to `Manage Extensions`
3. Click `Load unpacked`
4. Select the `packages/extension/dist` directory and hit `Load`

## License

AGPL-3.0-only
