/**
 * Content Manager
 * 
 * Handles all content creation, HTML generation, and UI components.
 * Consolidates the massive content viewer and UI creation methods.
 */

/**
 * ContentManager class handles all HTML content creation and UI generation
 */
export class ContentManager {
  constructor() {
    // No state needed - pure content generation
  }

  /**
   * Create content viewer HTML for different content types
   * @param {string} url - The content URL
   * @param {string} contentType - MIME type of the content
   * @returns {string|null} HTML content or null for native display
   */
  createContentViewer(url, contentType) {
    const type = contentType || 'unknown';

    if (type.startsWith('image/')) {
      return this._createImageViewer(url);
    } else if (type.startsWith('video/')) {
      return this._createVideoViewer(url);
    } else if (type.startsWith('audio/')) {
      return this._createAudioViewer(url);
    } else if (type === 'application/pdf') {
      // For PDFs, use iframe to show native PDF viewer
      return null; // Signal to use iframe.src directly
    } else if (type === 'application/x.arweave-manifest+json') {
      return this._createManifestViewer(url);
    } else if (this._isTextBasedContent(type)) {
      // For text-based content, let browser display natively
      return null;
    } else {
      // For unknown types, provide a download interface
      return this._createDownloadViewer(url, type);
    }
  }

  /**
   * Create HTML for image content
   * @param {string} url - Image URL
   * @returns {string} HTML content
   */
  _createImageViewer(url) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #f5f5f5; }
          img { max-width: 100%; height: auto; }
        </style>
      </head>
      <body>
        <img src="${url}" alt="Verified content">
      </body>
      </html>
    `;
  }

  /**
   * Create HTML for video content
   * @param {string} url - Video URL
   * @returns {string} HTML content
   */
  _createVideoViewer(url) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #000; }
          video { max-width: 100%; height: auto; }
        </style>
      </head>
      <body>
        <video src="${url}" controls autoplay></video>
      </body>
      </html>
    `;
  }

  /**
   * Create HTML for audio content
   * @param {string} url - Audio URL
   * @returns {string} HTML content
   */
  _createAudioViewer(url) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { 
            margin: 0; 
            display: flex; 
            justify-content: center; 
            align-items: center; 
            min-height: 100vh; 
            background: #1a1a1a;
            font-family: system-ui, -apple-system, sans-serif;
          }
          .audio-container {
            background: #2a2a2a;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            text-align: center;
          }
          .audio-icon {
            font-size: 64px;
            margin-bottom: 20px;
          }
          audio {
            width: 300px;
            margin: 20px 0;
          }
          .download-link {
            color: #2dd4bf;
            text-decoration: none;
            font-size: 14px;
            padding: 8px 16px;
            border: 1px solid #2dd4bf;
            border-radius: 6px;
            display: inline-block;
            margin-top: 10px;
            transition: all 0.2s;
          }
          .download-link:hover {
            background: #2dd4bf;
            color: #000;
          }
        </style>
      </head>
      <body>
        <div class="audio-container">
          <div class="audio-icon">🎵</div>
          <audio src="${url}" controls autoplay></audio>
          <br>
          <a href="${url}" download class="download-link">Download Audio</a>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Create HTML for Arweave manifest content
   * @param {string} url - Manifest URL
   * @returns {string} HTML content
   */
  _createManifestViewer(url) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { 
            font-family: system-ui, -apple-system, sans-serif; 
            margin: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: #1a1a1a;
            color: #fff;
          }
          .manifest-container {
            background: #2a2a2a;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            text-align: center;
            max-width: 500px;
          }
          .manifest-icon {
            font-size: 64px;
            margin-bottom: 20px;
          }
          h2 {
            margin: 0 0 10px 0;
            color: #2dd4bf;
          }
          .loading {
            color: #999;
            margin: 20px 0;
          }
          .error {
            color: #ff6b6b;
            margin: 20px 0;
          }
          .manifest-info {
            text-align: left;
            background: #1a1a1a;
            padding: 20px;
            border-radius: 8px;
            margin-top: 20px;
            font-family: monospace;
            font-size: 12px;
            max-height: 300px;
            overflow-y: auto;
          }
        </style>
        <script>
          // Fetch the manifest from the blob URL (which will work)
          fetch('${url}')
            .then(res => res.json())
            .then(manifest => {
              // Manifest loaded
              
              if (manifest.index && manifest.index.path) {
                // Get the current AR URL from viewer
                const currentUrl = new URL(window.location.href);
                const arUrl = currentUrl.searchParams.get('url');
                
                // Manifest index found
                
                if (arUrl) {
                  // Parse the current AR URL to get the base
                  const match = arUrl.match(/^ar:\\/\\/([^/]+)/);
                  if (match) {
                    const txId = match[1];
                    // Build the index URL
                    const indexUrl = 'ar://' + txId + '/' + manifest.index.path;
                    
                    // Redirecting to index
                    document.querySelector('.loading').textContent = 'Redirecting to ' + manifest.index.path + '...';
                    
                    // Redirect to the index file using viewer.html
                    setTimeout(() => {
                      window.top.location.href = 'viewer.html?url=' + encodeURIComponent(indexUrl);
                    }, 1000);
                  } else {
                    document.querySelector('.loading').className = 'error';
                    document.querySelector('.error').textContent = 'Invalid AR URL format';
                  }
                } else {
                  document.querySelector('.loading').className = 'error';
                  document.querySelector('.error').textContent = 'Could not determine manifest AR URL';
                }
              } else {
                // Show manifest contents if no index
                document.querySelector('.loading').textContent = 'No index file specified. Manifest contents:';
                const info = document.createElement('pre');
                info.className = 'manifest-info';
                info.textContent = JSON.stringify(manifest, null, 2);
                document.querySelector('.manifest-container').appendChild(info);
              }
            })
            .catch(err => {
              console.error('[VIEWER] Manifest fetch failed:', err.message || err);
              document.querySelector('.loading').className = 'error';
              document.querySelector('.error').textContent = 'Error loading manifest: ' + (err.message || 'Unknown error');
              // Prevent further errors by not propagating
            });
        </script>
      </head>
      <body>
        <div class="manifest-container">
          <div class="manifest-icon">📂</div>
          <h2>Arweave Manifest</h2>
          <p class="loading">Loading manifest...</p>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Create HTML for download interface for unknown content types
   * @param {string} url - Content URL
   * @param {string} type - Content type
   * @returns {string} HTML content
   */
  _createDownloadViewer(url, type) {
    const fileName = url.split('/').pop() || 'file';
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { 
            font-family: system-ui, -apple-system, sans-serif; 
            margin: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: #1a1a1a;
            color: #fff;
          }
          .download-container {
            background: #2a2a2a;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            text-align: center;
            max-width: 400px;
          }
          .file-icon {
            font-size: 64px;
            margin-bottom: 20px;
          }
          h2 {
            margin: 0 0 10px 0;
            color: #2dd4bf;
          }
          .file-type {
            color: #999;
            margin-bottom: 30px;
            font-size: 14px;
          }
          .download-btn {
            background: #2dd4bf;
            color: #000;
            text-decoration: none;
            font-size: 16px;
            font-weight: 600;
            padding: 12px 24px;
            border-radius: 8px;
            display: inline-block;
            transition: all 0.2s;
          }
          .download-btn:hover {
            background: #5eead4;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(45, 212, 191, 0.3);
          }
          .open-link {
            color: #999;
            font-size: 12px;
            margin-top: 20px;
            display: block;
          }
          .open-link a {
            color: #2dd4bf;
            text-decoration: none;
          }
          .open-link a:hover {
            text-decoration: underline;
          }
        </style>
      </head>
      <body>
        <div class="download-container">
          <div class="file-icon">📄</div>
          <h2>Verified Content Ready</h2>
          <p class="file-type">Content Type: ${type || 'Unknown'}</p>
          <a href="${url}" download="${fileName}" class="download-btn">Download File</a>
          <p class="open-link">
            Or <a href="${url}" target="_blank">open in new tab</a>
          </p>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Check if content type is text-based and should be displayed natively
   * @param {string} type - Content type
   * @returns {boolean} True if text-based content
   */
  _isTextBasedContent(type) {
    return (
      type.startsWith('text/plain') ||
      type.startsWith('text/csv') ||
      (type.startsWith('application/json') && !type.includes('manifest')) ||
      type.startsWith('application/xml') ||
      type.includes('javascript') ||
      type.includes('css')
    );
  }

  /**
   * Create manifest explorer HTML interface
   * @param {Object} manifest - Parsed manifest object
   * @param {Map} verifiedResources - Map of resource verification results
   * @param {Map} blobUrls - Map of blob URLs for resources
   * @returns {string} HTML content
   */
  createManifestExplorer(manifest, verifiedResources, blobUrls) {
    const totalResources = verifiedResources.size;
    const verifiedCount = Array.from(verifiedResources.values()).filter(r => r.verified).length;
    const failedCount = totalResources - verifiedCount;

    let resourcesHtml = '';
    for (const [path, pathData] of Object.entries(manifest.paths)) {
      const resource = verifiedResources.get(pathData.id);
      const verified = resource && resource.verified;
      const statusIcon = verified ? '✅' : '❌';
      const statusClass = verified ? 'verified' : 'failed';
      const blobUrl = blobUrls.get(pathData.id);
      
      const displayUrl = blobUrl && verified ? blobUrl : '#';
      const clickable = blobUrl && verified;
      
      resourcesHtml += `
        <div class="manifest-item ${statusClass}">
          <div class="manifest-status">${statusIcon}</div>
          <div class="manifest-info">
            <div class="manifest-path">
              ${clickable ? `<a href="${displayUrl}" target="_blank">${path}</a>` : path}
            </div>
            <div class="manifest-type">${resource ? resource.contentType : 'Unknown'}</div>
            <div class="manifest-id">${pathData.id}</div>
          </div>
        </div>
      `;
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { 
            font-family: system-ui, -apple-system, sans-serif; 
            margin: 0;
            padding: 20px;
            background: #f8f9fa;
            color: #333;
          }
          .manifest-header {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 20px;
          }
          .manifest-title {
            font-size: 24px;
            font-weight: 600;
            margin: 0 0 10px 0;
            color: #2c3e50;
          }
          .manifest-stats {
            display: flex;
            gap: 20px;
            margin-top: 15px;
          }
          .stat-item {
            text-align: center;
          }
          .stat-number {
            font-size: 20px;
            font-weight: 600;
          }
          .stat-number.verified { color: #27ae60; }
          .stat-number.failed { color: #e74c3c; }
          .stat-number.total { color: #3498db; }
          .stat-label {
            font-size: 12px;
            color: #7f8c8d;
            text-transform: uppercase;
          }
          .manifest-resources {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          .resources-header {
            padding: 15px 20px;
            border-bottom: 1px solid #e1e8ed;
            font-weight: 600;
            color: #2c3e50;
          }
          .manifest-item {
            display: flex;
            align-items: center;
            padding: 15px 20px;
            border-bottom: 1px solid #e1e8ed;
          }
          .manifest-item:last-child {
            border-bottom: none;
          }
          .manifest-item.verified {
            background: #f8fff8;
          }
          .manifest-item.failed {
            background: #fff8f8;
          }
          .manifest-status {
            margin-right: 15px;
            font-size: 16px;
          }
          .manifest-info {
            flex: 1;
          }
          .manifest-path {
            font-weight: 500;
            margin-bottom: 4px;
          }
          .manifest-path a {
            color: #3498db;
            text-decoration: none;
          }
          .manifest-path a:hover {
            text-decoration: underline;
          }
          .manifest-type {
            font-size: 12px;
            color: #7f8c8d;
            margin-bottom: 2px;
          }
          .manifest-id {
            font-size: 11px;
            color: #95a5a6;
            font-family: monospace;
          }
          .manifest-version {
            font-size: 14px;
            color: #7f8c8d;
            margin-bottom: 10px;
          }
        </style>
      </head>
      <body>
        <div class="manifest-header">
          <div class="manifest-title">📂 Arweave Manifest</div>
          <div class="manifest-version">Version: ${manifest.version}</div>
          <div class="manifest-stats">
            <div class="stat-item">
              <div class="stat-number total">${totalResources}</div>
              <div class="stat-label">Total</div>
            </div>
            <div class="stat-item">
              <div class="stat-number verified">${verifiedCount}</div>
              <div class="stat-label">Verified</div>
            </div>
            <div class="stat-item">
              <div class="stat-number failed">${failedCount}</div>
              <div class="stat-label">Failed</div>
            </div>
          </div>
        </div>
        
        <div class="manifest-resources">
          <div class="resources-header">Resources</div>
          ${resourcesHtml}
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Show progressive choice modal for user decision
   * @param {number} remainingCount - Number of remaining resources
   * @param {number} verified - Number of verified resources
   * @param {number} failed - Number of failed resources
   * @returns {Promise<boolean>} True if user wants to continue, false to view now
   */
  async showProgressiveChoice(remainingCount, verified, failed) {
    return new Promise((resolve) => {
      // Update the pre-fetch modal to show choice
      const modal = document.getElementById('prefetchModal');
      const content = modal.querySelector('.prefetch-content');
      
      content.innerHTML = `
        <div class="prefetch-header">
          <h2>Critical Resources Verified</h2>
          <p>Essential content is ready to view. ${remainingCount} additional resources remain.</p>
        </div>
        
        <div class="verification-summary">
          <div class="summary-stat">
            <span class="stat-value verified">${verified}</span>
            <span class="stat-label">Verified</span>
          </div>
          <div class="summary-stat">
            <span class="stat-value failed">${failed}</span>
            <span class="stat-label">Failed</span>
          </div>
          <div class="summary-stat">
            <span class="stat-value pending">${remainingCount}</span>
            <span class="stat-label">Remaining</span>
          </div>
        </div>
        
        <div class="progressive-choice">
          <p>You can view the content now or continue verifying all resources.</p>
          <div class="choice-buttons">
            <button class="btn btn-secondary" id="viewNowBtn">View Now</button>
            <button class="btn btn-primary" id="continueBtn">Verify All (${Math.round(remainingCount/10)}min est.)</button>
          </div>
        </div>
      `;
      
      // Set up button handlers
      const viewNowBtn = content.querySelector('#viewNowBtn');
      const continueBtn = content.querySelector('#continueBtn');
      
      viewNowBtn.onclick = () => {
        modal.style.display = 'none';
        resolve(false);
      };
      
      continueBtn.onclick = () => {
        modal.style.display = 'none';
        resolve(true);
      };
      
      // Auto-continue after 10 seconds
      setTimeout(() => {
        if (modal.style.display !== 'none') {
          modal.style.display = 'none';
          resolve(false);
        }
      }, 10000);
    });
  }
}

// Create a global instance for easy use
export const contentManager = new ContentManager();

// Convenience functions that use the global instance
export const createContentViewer = (url, contentType) => 
  contentManager.createContentViewer(url, contentType);

export const createManifestExplorer = (manifest, verifiedResources, blobUrls) => 
  contentManager.createManifestExplorer(manifest, verifiedResources, blobUrls);

export const showProgressiveChoice = (remainingCount, verified, failed) => 
  contentManager.showProgressiveChoice(remainingCount, verified, failed);