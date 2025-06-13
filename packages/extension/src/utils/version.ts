/**
 * Version utility to get extension version from manifest
 */

export async function getExtensionVersion(): Promise<string> {
  try {
    // Get manifest data using chrome extension API
    const manifest = chrome.runtime.getManifest();
    return manifest.version || '0.1.0';
  } catch (error) {
    console.error('Failed to get extension version:', error);
    return '0.1.0';
  }
}
