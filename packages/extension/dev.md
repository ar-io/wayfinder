# Fast Development Workflow for Wayfinder Extension

## Quick Reload Method (Recommended)

1. **Start the watch mode** (in one terminal):
   ```bash
   npm run watch -w packages/extension
   ```
   This will automatically rebuild when you make changes.

2. **Load the extension once**:
   - Open `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `packages/extension/dist` folder

3. **Reload after changes**:
   - When you make code changes, the watch command will rebuild automatically
   - Go to `chrome://extensions`
   - Click the refresh icon on the Wayfinder extension card (or press Ctrl+R on the page)
   - No need to remove and re-add!

## Even Faster: Keyboard Shortcuts

1. Pin the reload button:
   - On `chrome://extensions`, you can press `Ctrl+R` to reload all extensions
   - Or click the circular arrow button on your specific extension

2. Use the Extension Reloader extension:
   - Install "Extension Reloader" from Chrome Web Store
   - It adds a button to reload all unpacked extensions with one click

## Development Tips

### Hot Module Replacement (Limited)
For popup and options pages, you can add:
```javascript
if (import.meta.hot) {
  import.meta.hot.accept();
}
```

### Preserve State
To preserve state between reloads:
- Use `chrome.storage.local` instead of in-memory variables
- State will persist across extension reloads

### Quick Test URLs
Keep these handy for testing:
- Simple JSON: `ar://BdnZbu6Uq0Lb05Nb_zaFwwocnBW9hCs4XvcOZ0MYqZM`
- HTML page: `ar://1984`
- ArNS name: `ardrive.ar.io`

### Console Access
- Background script: Go to `chrome://extensions` → Wayfinder → "Inspect views: service worker"
- Popup: Right-click the extension icon → "Inspect popup"
- Content scripts: Use regular DevTools on the page

### Clear Extension Storage
```javascript
// Run in background script console to reset
chrome.storage.local.clear();
```

## Fastest Workflow Summary

1. Run `npm run watch -w packages/extension` (keep running)
2. Make your changes
3. Press Ctrl+R on `chrome://extensions` page
4. Test your changes

No need to remove and re-add the extension!