# WayFinder Chrome Extension

The WayFinder Chrome extension intelligently routes users to optimal AR.IO gateways, ensuring streamlined access to the permaweb on Arweave.

## Features

- **ar:// Protocol Support**: Type ar:// URLs directly in the browser search bar or click ar:// links on any webpage
- **Intelligent Gateway Routing**: Automatically selects the best gateway based on performance, stake, or your preferences
- **ArNS Name Resolution**: Seamlessly resolves Arweave Name System (ArNS) names to transaction IDs
- **ENS Integration**: Optional support for Ethereum Name Service (ENS) names pointing to Arweave content
- **DNS TXT Record Support**: Resolves gasless ArNS names via DNS TXT records
- **Multiple Routing Strategies**:
  - Fastest Ping: Routes to the gateway with the lowest latency
  - Balanced (Random): Distributes load across all available gateways
  - Static: Use a specific gateway of your choice
- **Healthy Gateway Routing**: Automatically filters out gateways with consecutive failed network epochs
- **Real-time Performance Tracking**: Monitors gateway response times and success rates
- **Circuit Breaker Protection**: Temporarily disables failing gateways to ensure reliability
- **Gateway Registry Sync**: Stays up-to-date with the AR.IO network's gateway registry
- **Usage Analytics**: Track your gateway usage patterns and performance metrics
- **Customizable Settings**: Fine-tune routing behavior, caching, and more
- **Dark/Light Theme Support**: Automatic theme detection with manual override
- **Privacy-Focused**: No personal data collection, optional anonymous telemetry

## Installation

### From Chrome Web Store
(Coming soon)

### Development Build

#### Requirements
- Node.js v22+
- npm v10.9.2+

#### Build Instructions

```bash
# Clone the repository
git clone https://github.com/ar-io/wayfinder.git
cd wayfinder

# Install dependencies
npm install

# Build the extension
npm run build -w packages/wayfinder-extension

# The built extension will be in packages/wayfinder-extension/dist
```

### Loading into Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked"
4. Select the `packages/wayfinder-extension/dist` directory
5. The WayFinder extension icon should appear in your toolbar

## Usage

### Basic Usage

1. **Search Bar**: Type `ar://` followed by a transaction ID or ArNS name in the Chrome search bar
   - Example: `ar://ardrive` or `ar://Fwd2_H1wNvTxSZBmPZ5db9PULNfW1SCkd2nxDbiPU0E`

2. **Click Links**: Click on any `ar://` link on a webpage, and WayFinder will automatically route it

3. **Popup Menu**: Click the WayFinder icon in the toolbar to see:
   - Active gateway count
   - Average response time
   - Today's request count
   - Current routing strategy

### Configuration

Click the settings icon in the popup to access:

#### Routing Configuration
- **Routing Strategy**: Choose between Fastest Ping, Balanced, or Static gateway
- **Static Gateway**: Configure and test a specific gateway URL
- **Gateway Sorting**: Order gateways by operator stake or total delegated stake

#### Network Configuration
- **Gateway Registry Sync**: Manually refresh the gateway list from AR.IO network
- **ENS Resolution**: Enable/disable Ethereum Name Service support
- **Process ID**: Configure custom AR.IO process ID (advanced)
- **AO CU URL**: Set custom AO Compute Unit URL (advanced)

#### Performance Settings
- **Gateway Cache TTL**: Set how long to cache gateway information
- **Telemetry**: Enable anonymous ar:// request telemetry

#### Data Management
- **Clear Cache**: Remove gateway performance data and usage history
- **Factory Reset**: Reset entire extension to original state

### Pages

#### Gateways Page
View all available gateways with:
- Real-time status (Active/Inactive)
- Average response time
- Success rate
- Total stake
- Blacklist management

#### Performance Page
Monitor your usage with:
- Gateway usage statistics
- Response time trends
- Success rates
- Request distribution
- Time-based filtering (Today/Week/Month/All)

## How It Works

1. **URL Interception**: When you navigate to an ar:// URL, WayFinder intercepts the request
2. **Name Resolution**: If needed, resolves ArNS or ENS names to Arweave transaction IDs
3. **Gateway Selection**: Based on your routing strategy, selects the optimal gateway from healthy gateways only
4. **Healthy Gateway Filtering**: Excludes gateways with consecutive failed network epochs from the routing pool
5. **Performance Tracking**: Records response time and success/failure for future routing decisions
6. **Circuit Breaking**: If a gateway fails multiple times, temporarily removes it from rotation

## Development

### Project Structure

```
src/
├── background.ts      # Service worker handling ar:// navigation
├── content.ts         # Content script for in-page ar:// links
├── routing.ts         # WayFinder core integration
├── popup.js          # Extension popup UI
├── settings.js       # Settings page
├── gateways.js       # Gateway list management
├── performance.js    # Performance analytics
└── config/
    └── defaults.ts   # Default configuration values
```

### Key Technologies

- **Build System**: Vite with Chrome extension support
- **Core Library**: @ar.io/wayfinder-core for routing logic
- **Gateway Discovery**: @ar.io/sdk for AR.IO network integration
- **Storage**: Chrome storage API for persistence
- **Networking**: WebRequest API for request interception

### Scripts

```bash
# Development build with watch mode
npm run dev -w packages/wayfinder-extension

# Production build
npm run build -w packages/wayfinder-extension

# Clean build artifacts
npm run clean -w packages/wayfinder-extension

# Lint and format
npm run lint:fix -w packages/wayfinder-extension
npm run format:fix -w packages/wayfinder-extension
```

## Privacy

WayFinder is designed with privacy in mind:
- No personal data is collected or transmitted
- All settings and usage data are stored locally in your browser
- Optional telemetry only includes anonymous routing performance metrics
- No tracking of visited ar:// URLs or content

## Troubleshooting

### Common Issues

**No gateways available**
- Click Settings → Network Configuration → Sync Gateway Registry
- Check your internet connection
- Ensure the AR.IO network is accessible

**ar:// URLs not working**
- Verify the extension is enabled in Chrome
- Check if the URL is properly formatted (ar://[txid] or ar://[name])
- Try a different routing strategy in settings

**Slow performance**
- Switch to "Fastest Ping" routing strategy
- Clear cache in Settings → Data Management
- Check Performance page for failing gateways

**Extension not loading**
- Ensure you're using a compatible Chrome version
- Try reloading the extension in chrome://extensions/
- Check browser console for error messages

## Contributing

Contributions are welcome! Please see the main [WayFinder repository](https://github.com/ar-io/wayfinder) for contribution guidelines.

## License

Apache-2.0
