/**
 * Wayfinder Verified Browsing - Service Worker
 * Intercepts and verifies all requests to ar.io network gateways
 */

// Known ar.io gateways (will be updated dynamically)
let knownGateways = new Set([
  'arweave.net',
  'ar-io.net',
  'ar.io',
  'g8way.io',
  'ar-io.dev',
  'arweave.dev',
  'arweave.live',
  'permaweb.io',
]);

// Verification cache to avoid re-verifying same resources
const verificationCache = new Map();
const CACHE_TTL = 3600000; // 1 hour

// Verification settings
let verificationSettings = {
  strict: false,
  strategy: 'hash',
};

// Message port for communication with viewer.html
let messagePort = null;

/**
 * Check if URL is from an ar.io gateway
 */
function isArIOGatewayRequest(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    // Check exact match
    if (knownGateways.has(hostname)) {
      return true;
    }

    // Check subdomain patterns (e.g., *.ar.io)
    for (const gateway of knownGateways) {
      if (hostname.endsWith(`.${gateway}`) || hostname === gateway) {
        return true;
      }
    }

    // Check if it's a gateway serving ar:// content
    const pathname = urlObj.pathname;
    if (pathname.match(/^\/[a-zA-Z0-9_-]{43}/)) {
      // Looks like a transaction ID
      return true;
    }

    return false;
  } catch (_error) {
    return false;
  }
}

/**
 * Extract resource type from URL and headers
 */
function getResourceType(url, headers) {
  const pathname = new URL(url).pathname.toLowerCase();
  const contentType = headers.get('content-type') || '';

  if (contentType.includes('javascript') || pathname.endsWith('.js')) {
    return 'script';
  } else if (contentType.includes('css') || pathname.endsWith('.css')) {
    return 'style';
  } else if (
    contentType.includes('image') ||
    pathname.match(/\.(jpg|jpeg|png|gif|webp|svg|ico)$/)
  ) {
    return 'media';
  } else if (
    contentType.includes('video') ||
    contentType.includes('audio') ||
    pathname.match(/\.(mp4|webm|mp3|wav)$/)
  ) {
    return 'media';
  } else if (contentType.includes('json') || pathname.endsWith('.json')) {
    return 'api';
  } else if (contentType.includes('html')) {
    return 'document';
  } else {
    return 'other';
  }
}

/**
 * Send verification request to extension background
 */
async function verifyWithWayfinder(url, resourceType) {
  // Check cache first
  const cacheKey = `${url}:${verificationSettings.strategy}`;
  const cached = verificationCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result;
  }

  try {
    // Send message to viewer.html which will relay to background
    const response = await sendMessageToViewer({
      type: 'VERIFY_RESOURCE',
      url: url,
      resourceType: resourceType,
      strategy: verificationSettings.strategy,
    });

    const result = {
      verified: response.verified,
      error: response.error,
      timestamp: Date.now(),
    };

    // Cache result
    verificationCache.set(cacheKey, { result, timestamp: Date.now() });

    return result;
  } catch (error) {
    console.error('[SW] Verification error:', error);
    return { verified: false, error: error.message };
  }
}

/**
 * Send message to viewer.html
 */
function sendMessageToViewer(message) {
  return new Promise((resolve, reject) => {
    if (!messagePort) {
      reject(new Error('No message port available'));
      return;
    }

    const messageId = Math.random().toString(36).substr(2, 9);
    const channel = new MessageChannel();

    // Listen for response
    channel.port1.onmessage = (event) => {
      if (event.data.id === messageId) {
        resolve(event.data.result);
      }
    };

    // Send message with response port
    messagePort.postMessage(
      {
        ...message,
        id: messageId,
      },
      [channel.port2],
    );

    // Timeout after 5 seconds
    setTimeout(() => {
      reject(new Error('Verification timeout'));
    }, 5000);
  });
}

/**
 * Update resource stats
 */
async function updateResourceStats(resourceType, verified) {
  try {
    await sendMessageToViewer({
      type: 'UPDATE_STATS',
      resourceType: resourceType,
      verified: verified,
    });
  } catch (error) {
    console.error('[SW] Failed to update stats:', error);
  }
}

/**
 * Handle fetch events
 */
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Only intercept ar.io gateway requests
  if (!isArIOGatewayRequest(url)) {
    return; // Let non-gateway requests pass through
  }

  // Don't intercept our own extension URLs
  if (url.startsWith('chrome-extension://')) {
    return;
  }

  event.respondWith(handleVerifiedFetch(event.request));
});

/**
 * Handle verified fetch
 */
async function handleVerifiedFetch(request) {
  const url = request.url;

  try {
    // First, make the actual request
    const response = await fetch(request);

    // Extract resource type from response
    const resourceType = getResourceType(url, response.headers);

    // Clone response for verification (can't read body twice)
    const _responseToVerify = response.clone();

    // Verify in background (non-blocking by default)
    verifyWithWayfinder(url, resourceType)
      .then((result) => {
        updateResourceStats(resourceType, result.verified);

        if (!result.verified && verificationSettings.strict) {
          console.error('[SW] Verification failed for:', url);
          // In strict mode, we would have blocked the response
          // but it's too late now since we already returned it
        }
      })
      .catch((error) => {
        console.error('[SW] Verification error:', error);
        updateResourceStats(resourceType, false);
      });

    // Return response immediately (non-blocking verification)
    return response;
  } catch (fetchError) {
    console.error('[SW] Fetch error:', fetchError);

    // Return error response
    return new Response('Network error', {
      status: 503,
      statusText: 'Service Unavailable',
    });
  }
}

/**
 * Handle messages from viewer.html
 */
self.addEventListener('message', (event) => {
  if (event.data.type === 'INIT_PORT') {
    // Save message port for communication
    messagePort = event.ports[0];
    console.log('[SW] Message port initialized');

    // Send ready signal
    messagePort.postMessage({ type: 'SW_READY' });
  } else if (event.data.type === 'UPDATE_GATEWAYS') {
    // Update known gateways list
    knownGateways = new Set(event.data.gateways);
    console.log('[SW] Updated gateways:', knownGateways.size);
  } else if (event.data.type === 'UPDATE_SETTINGS') {
    // Update verification settings
    verificationSettings = event.data.settings;
    console.log('[SW] Updated settings:', verificationSettings);
  }
});

/**
 * Service worker activation
 */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activated');
  // Take control of all clients immediately
  event.waitUntil(self.clients.claim());
});

/**
 * Service worker installation
 */
self.addEventListener('install', (_event) => {
  console.log('[SW] Installing...');
  // Skip waiting to activate immediately
  self.skipWaiting();
});
