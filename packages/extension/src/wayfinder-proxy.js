/**
 * Wayfinder Resource Proxy
 * This script handles loading and serving verified resources
 */

// Parse URL parameters
const urlParams = new URLSearchParams(window.location.search);
const arUrl = urlParams.get('url');

if (!arUrl) {
  document.getElementById('status').textContent = 'Error: No URL specified';
} else {
  loadResource();
}

async function loadResource() {
  try {
    // Request the resource through background script with Wayfinder
    const response = await chrome.runtime.sendMessage({
      type: 'FETCH_VERIFIED_RESOURCE',
      url: arUrl
    });

    if (response.error) {
      throw new Error(response.error);
    }

    // Determine content type
    const contentType = response.contentType || guessContentType(arUrl);
    
    // Create blob from base64 data
    if (response.dataUrl) {
      // Extract base64 data from data URL
      const base64Match = response.dataUrl.match(/^data:[^;]+;base64,(.+)$/);
      if (base64Match) {
        const binaryString = atob(base64Match[1]);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: contentType });
        
        // Create object URL and redirect to it
        const objectUrl = URL.createObjectURL(blob);
        
        // For scripts and styles, we need to serve them differently
        if (contentType.includes('javascript') || contentType.includes('css')) {
          // Set proper headers by replacing the document
          document.open();
          document.write(`<script>
            // Redirect to blob URL with proper content type
            window.location.replace('${objectUrl}');
          </script>`);
          document.close();
        } else {
          // For other resources, just redirect
          window.location.replace(objectUrl);
        }
      }
    } else if (response.content) {
      // Handle direct content (future enhancement)
      const blob = new Blob([response.content], { type: contentType });
      const objectUrl = URL.createObjectURL(blob);
      window.location.replace(objectUrl);
    } else {
      throw new Error('No content received');
    }
    
  } catch (error) {
    console.error('Proxy error:', error);
    document.getElementById('status').textContent = `Error: ${error.message}`;
    
    // Return error response
    if (arUrl && arUrl.includes('.js')) {
      // For scripts, return an error script
      document.open();
      document.write(`console.error('Failed to load verified resource: ${arUrl}', '${error.message}');`);
      document.close();
    } else if (arUrl && arUrl.includes('.css')) {
      // For styles, return empty CSS
      document.open();
      document.write(`/* Failed to load verified resource: ${arUrl} - ${error.message} */`);
      document.close();
    }
  }
}

function guessContentType(url) {
  const ext = url.split('.').pop()?.toLowerCase();
  const mimeTypes = {
    'js': 'application/javascript',
    'mjs': 'application/javascript',
    'css': 'text/css',
    'html': 'text/html',
    'htm': 'text/html',
    'json': 'application/json',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'webp': 'image/webp',
    'woff': 'font/woff',
    'woff2': 'font/woff2',
    'ttf': 'font/ttf',
    'otf': 'font/otf',
    'txt': 'text/plain',
    'xml': 'application/xml',
    'pdf': 'application/pdf',
    'zip': 'application/zip',
    'wasm': 'application/wasm'
  };
  
  return mimeTypes[ext] || 'application/octet-stream';
}