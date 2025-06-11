# WayFinder Chrome Extension

The WayFinder Chrome extension intelligently routes users to optimal AR.IO gateways, ensuring streamlined access to the permaweb on Arweave.

## Features

- ar:// routing in the browser search bar and within pages
- Automatically routes ArNS names and Arweave Transaction IDs to available gateways
- DNS TXT Record Redirection for user-friendly permaweb navigation
- Algorithmic Gateway Selection for optimal routing
- Gateway Discovery through AR.IO Gateway Address registry
- Static Gateway Configuration for advanced users
- Continuous Gateway Health Checks
- Usage History and metrics
- UI Theming with light and dark modes
- Privacy-Preserving Design

## Development

### Requirements

- `node` - v22+
- `npm` - v10.9.2

### Build

```bash
# Install dependencies
npm install

# Build the extension
yarn build
```

### Loading into Chrome

1. Run `yarn build` to create a fresh `dist` directory
2. Navigate to `Manage Extensions`
3. Click `Load unpacked`
4. Select the `dist` directory and hit `Load`

## License

AGPL-3.0-only
