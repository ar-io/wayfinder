/**
 * WayFinder Extension - Sandbox Content Renderer
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc.
 *
 * Licensed under the Apache License, Version 2.0
 *
 * This script runs inside the sandboxed iframe where CSP restrictions are relaxed.
 * It receives verified content from the parent (verified.html) via postMessage
 * and renders it in the sandbox where eval() and inline scripts are allowed.
 *
 * Communication flow:
 * 1. Parent sends 'RENDER_CONTENT' with HTML string
 * 2. Sandbox writes the HTML to document
 * 3. Parent sends 'ADD_RESOURCE' for each sub-resource (JS, CSS, images)
 * 4. Sandbox creates blob URLs and injects them
 */

// Store blob URLs for cleanup
const blobUrls: string[] = [];

// Store resources by path for URL rewriting
const resourceBlobUrls = new Map<string, string>();

// The identifier being rendered
let currentIdentifier: string | null = null;

// Save references to native functions BEFORE any scripts can modify them
// This protects against scripts that polyfill or modify prototypes
const nativeCreateElement = document.createElement.bind(document);
const nativeAppendChild = Node.prototype.appendChild;
const nativeMapGet = Map.prototype.get;
const nativeStringIndexOf = String.prototype.indexOf;
const nativeStringSubstring = String.prototype.substring;
const nativeRegExpTest = RegExp.prototype.test;

/**
 * Initialize message listener
 */
function init(): void {
  window.addEventListener('message', handleMessage);

  // Let parent know we're ready
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'SANDBOX_READY' }, '*');
  }
}

/**
 * Handle messages from parent
 */
function handleMessage(event: MessageEvent): void {
  const { type, ...data } = event.data || {};

  switch (type) {
    case 'RENDER_CONTENT':
      handleRenderContent(data, event.source as Window);
      break;

    case 'ADD_RESOURCE':
      handleAddResource(data);
      break;

    case 'CLEAR_CONTENT':
      handleClearContent();
      break;
  }
}

/**
 * Render the main HTML content
 */
function handleRenderContent(
  data: {
    html: string;
    identifier: string;
    resources: Array<{ path: string; data: ArrayBuffer; contentType: string }>;
  },
  source: Window,
): void {
  // Clear previous content first to avoid script conflicts
  handleClearContent();

  currentIdentifier = data.identifier;

  const resourceCount = data.resources?.length || 0;
  console.log('[Sandbox] Received resources:', resourceCount);

  // Log specific paths we're looking for
  const splashPath = data.resources?.find((r) => r.path.includes('splash'));
  const iconPath = data.resources?.find((r) => r.path.includes('Icon-192'));
  console.log('[Sandbox] Has splash?', splashPath?.path || 'NOT FOUND');
  console.log('[Sandbox] Has Icon-192?', iconPath?.path || 'NOT FOUND');

  // First pass: create blob URLs for non-CSS resources
  // We need to do CSS files in a second pass after we have all resource URLs
  const cssResources: Array<{
    path: string;
    data: ArrayBuffer;
    contentType: string;
  }> = [];

  for (const resource of data.resources || []) {
    if (resource.contentType?.includes('css')) {
      cssResources.push(resource);
    } else {
      // Fix WASM content-type - gateways may return text/plain but WebAssembly
      // requires application/wasm for instantiateStreaming() to work
      let contentType = resource.contentType;
      if (resource.path.endsWith('.wasm')) {
        contentType = 'application/wasm';
      }
      const blob = new Blob([resource.data], { type: contentType });
      const blobUrl = URL.createObjectURL(blob);
      blobUrls.push(blobUrl);
      resourceBlobUrls.set(resource.path, blobUrl);

      // Debug: log splash path storage
      if (resource.path.includes('splash')) {
        console.log(
          '[Sandbox] Stored splash resource:',
          resource.path,
          '-> blob URL created',
        );
      }

      // Also map with leading slash
      if (!resource.path.startsWith('/')) {
        resourceBlobUrls.set('/' + resource.path, blobUrl);
      }
    }
  }

  // Second pass: process CSS files and rewrite url() references inside them
  for (const resource of cssResources) {
    let cssContent = new TextDecoder().decode(resource.data);

    // Rewrite url() references in the CSS to use blob URLs
    cssContent = rewriteCssUrls(cssContent);

    const blob = new Blob([cssContent], { type: resource.contentType });
    const blobUrl = URL.createObjectURL(blob);
    blobUrls.push(blobUrl);
    resourceBlobUrls.set(resource.path, blobUrl);

    if (!resource.path.startsWith('/')) {
      resourceBlobUrls.set('/' + resource.path, blobUrl);
    }
  }

  // Rewrite resource URLs in the HTML
  let processedHtml = data.html;

  // Rewrite src and href attributes to use blob URLs
  processedHtml = rewriteResourceUrls(processedHtml);

  // Get the content container
  const container = document.getElementById('sandbox-content');
  if (!container) {
    console.error('[Sandbox] No content container found');
    return;
  }

  // Remove loading class
  container.classList.remove('loading');

  // Inject polyfills and URL interceptors BEFORE any content scripts run
  // These must be available when the app's scripts execute
  injectSandboxPolyfills();
  installUrlInterceptors();

  // Write the content
  // Using document.write would reset the whole document, so we use innerHTML
  // and handle scripts separately
  const { html: cleanHtml, scripts } = extractScripts(processedHtml);

  container.innerHTML = cleanHtml;

  // Execute scripts in order
  executeScripts(scripts).then(() => {
    source.postMessage(
      { type: 'RENDER_COMPLETE', identifier: currentIdentifier },
      '*',
    );
  });
}

/**
 * Inject polyfills for browser APIs that don't work in sandbox unique origin.
 * Some apps check for service workers, caches, etc. which fail in sandbox.
 *
 * IMPORTANT: In a sandboxed iframe without allow-same-origin, many APIs throw
 * SecurityError even when just READING them. We must use try/catch around each.
 */
function injectSandboxPolyfills(): void {
  // Stub navigator.serviceWorker - accessing it throws SecurityError in sandbox
  try {
    // Just accessing navigator.serviceWorker throws in sandbox, so we need to
    // define it unconditionally
    Object.defineProperty(navigator, 'serviceWorker', {
      get: () => ({
        ready: Promise.resolve(null),
        register: () =>
          Promise.reject(new Error('Service workers not available in sandbox')),
        getRegistration: () => Promise.resolve(undefined),
        getRegistrations: () => Promise.resolve([]),
        controller: null,
        oncontrollerchange: null,
        onmessage: null,
        onmessageerror: null,
        addEventListener: () => {
          /* noop - stub */
        },
        removeEventListener: () => {
          /* noop - stub */
        },
        dispatchEvent: () => false,
      }),
      configurable: true,
    });
  } catch (e) {
    // Property may already be defined or not configurable
    console.debug('[Sandbox] Could not stub navigator.serviceWorker:', e);
  }

  // Stub caches API - also throws SecurityError in sandbox
  try {
    Object.defineProperty(window, 'caches', {
      get: () => ({
        open: () =>
          Promise.reject(new Error('Cache API not available in sandbox')),
        has: () => Promise.resolve(false),
        delete: () => Promise.resolve(false),
        keys: () => Promise.resolve([]),
        match: () => Promise.resolve(undefined),
      }),
      configurable: true,
    });
  } catch (e) {
    console.debug('[Sandbox] Could not stub caches:', e);
  }

  // Stub indexedDB - may not work in sandbox
  try {
    if (typeof indexedDB === 'undefined' || indexedDB === null) {
      Object.defineProperty(window, 'indexedDB', {
        get: () => null,
        configurable: true,
      });
    }
  } catch (e) {
    console.debug('[Sandbox] Could not stub indexedDB:', e);
  }

  // Stub localStorage - throws SecurityError in sandbox without allow-same-origin
  try {
    const memoryStorage: Record<string, string> = {};
    Object.defineProperty(window, 'localStorage', {
      get: () => ({
        getItem: (key: string) => memoryStorage[key] ?? null,
        setItem: (key: string, value: string) => {
          memoryStorage[key] = String(value);
        },
        removeItem: (key: string) => {
          delete memoryStorage[key];
        },
        clear: () => {
          Object.keys(memoryStorage).forEach((k) => delete memoryStorage[k]);
        },
        key: (index: number) => Object.keys(memoryStorage)[index] ?? null,
        get length() {
          return Object.keys(memoryStorage).length;
        },
      }),
      configurable: true,
    });
  } catch (e) {
    console.debug('[Sandbox] Could not stub localStorage:', e);
  }

  // Stub sessionStorage - also throws SecurityError
  try {
    const memorySessionStorage: Record<string, string> = {};
    Object.defineProperty(window, 'sessionStorage', {
      get: () => ({
        getItem: (key: string) => memorySessionStorage[key] ?? null,
        setItem: (key: string, value: string) => {
          memorySessionStorage[key] = String(value);
        },
        removeItem: (key: string) => {
          delete memorySessionStorage[key];
        },
        clear: () => {
          Object.keys(memorySessionStorage).forEach(
            (k) => delete memorySessionStorage[k],
          );
        },
        key: (index: number) =>
          Object.keys(memorySessionStorage)[index] ?? null,
        get length() {
          return Object.keys(memorySessionStorage).length;
        },
      }),
      configurable: true,
    });
  } catch (e) {
    console.debug('[Sandbox] Could not stub sessionStorage:', e);
  }

  // Stub document.cookie - throws SecurityError in sandbox
  try {
    Object.defineProperty(document, 'cookie', {
      get: () => '',
      set: () => {
        /* noop - ignore cookie writes */
      },
      configurable: true,
    });
  } catch (e) {
    console.debug('[Sandbox] Could not stub document.cookie:', e);
  }

  // Some apps check window.trustedTypes which may be undefined
  try {
    if (typeof (window as any).trustedTypes === 'undefined') {
      (window as any).trustedTypes = {
        createPolicy: () => ({
          createHTML: (s: string) => s,
          createScript: (s: string) => s,
          createScriptURL: (s: string) => s,
        }),
        isHTML: () => false,
        isScript: () => false,
        isScriptURL: () => false,
        emptyHTML: '',
        emptyScript: '',
        getAttributeType: () => null,
        getPropertyType: () => null,
        defaultPolicy: null,
      };
    }
  } catch (e) {
    console.debug('[Sandbox] Could not stub trustedTypes:', e);
  }

  // Provide window.__wayfinder for apps that want to detect they're in verified mode
  (window as any).__wayfinder = {
    verified: true,
    sandbox: true,
  };

  // Flutter-specific environment setup
  // Flutter uses these to determine base paths and configuration
  try {
    // Set base element if not present - Flutter uses this for path resolution
    if (!document.querySelector('base')) {
      const base = document.createElement('base');
      base.href = '/';
      document.head.insertBefore(base, document.head.firstChild);
    }

    // Flutter configuration that some builds look for
    (window as any).flutterConfiguration = {
      assetBase: '/',
      canvasKitBaseUrl: '/canvaskit/',
    };

    // Some Flutter versions look for this
    if (!(window as any)._flutter) {
      (window as any)._flutter = {};
    }
  } catch (e) {
    console.debug('[Sandbox] Could not set Flutter configuration:', e);
  }

  // Mock document.currentScript to provide the original script path
  // This is critical for Flutter and other frameworks that use document.currentScript.src
  // to determine the base path for loading additional resources.
  // Without this, blob URLs break path resolution.
  try {
    Object.defineProperty(document, 'currentScript', {
      get: () => {
        if (!currentExecutingScriptSrc) {
          return null;
        }
        // Return a mock HTMLScriptElement with the original src
        // We can't return a real element, but we can return an object
        // with the properties that frameworks typically access
        return {
          src: currentExecutingScriptSrc,
          // Provide absolute URL based on the original path
          getAttribute: (name: string) => {
            if (name === 'src') return currentExecutingScriptSrc;
            return null;
          },
          // Common properties that might be accessed
          async: false,
          defer: false,
          type: '',
          text: '',
          charset: '',
          crossOrigin: null,
          noModule: false,
          // Make it look like an element
          tagName: 'SCRIPT',
          nodeName: 'SCRIPT',
          nodeType: 1,
        } as unknown as HTMLScriptElement;
      },
      configurable: true,
    });
  } catch (e) {
    console.debug('[Sandbox] Could not mock document.currentScript:', e);
  }

  console.log('[Sandbox] Polyfills injected successfully');
}

/**
 * Install URL interceptors to redirect resource requests to blob URLs.
 * This intercepts fetch, XMLHttpRequest, Image, and element src/href setters.
 *
 * IMPORTANT: This must run BEFORE any app scripts execute.
 */
function installUrlInterceptors(): void {
  // Expose the resolver globally so apps can use it if needed
  (window as any).__wayfinderResolveUrl = resolveResourceUrl;

  // === FETCH INTERCEPTION ===
  const originalFetch = window.fetch;
  window.fetch = function (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    let url: string;
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof URL) {
      url = input.href;
    } else if (input instanceof Request) {
      url = input.url;
    } else {
      return originalFetch.call(this, input, init);
    }

    const resolved = resolveResourceUrl(url);
    if (resolved !== url) {
      console.debug('[Sandbox] fetch intercepted:', url, '->', resolved);
      if (typeof input === 'string') {
        return originalFetch.call(this, resolved, init);
      } else if (input instanceof URL) {
        return originalFetch.call(this, new URL(resolved), init);
      } else {
        // Request object - create new request with resolved URL
        return originalFetch.call(this, new Request(resolved, input), init);
      }
    }
    return originalFetch.call(this, input, init);
  };

  // === XMLHTTPREQUEST INTERCEPTION ===
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    async: boolean = true,
    username?: string | null,
    password?: string | null,
  ): void {
    const urlStr = url instanceof URL ? url.href : url;
    const resolved = resolveResourceUrl(urlStr);
    if (resolved !== urlStr) {
      console.debug('[Sandbox] XHR intercepted:', urlStr, '->', resolved);
      return originalXhrOpen.call(
        this,
        method,
        resolved,
        async,
        username,
        password,
      );
    }
    return originalXhrOpen.call(this, method, url, async, username, password);
  };

  // === IMAGE INTERCEPTION ===
  // Intercept Image constructor - prototype setter handles src interception
  const OriginalImage = window.Image;
  (window as any).Image = function (
    width?: number,
    height?: number,
  ): HTMLImageElement {
    return new OriginalImage(width, height);
  };
  // Preserve prototype chain
  (window as any).Image.prototype = OriginalImage.prototype;

  // Intercept HTMLImageElement.prototype.src setter
  const imgSrcDescriptor = Object.getOwnPropertyDescriptor(
    HTMLImageElement.prototype,
    'src',
  );
  if (imgSrcDescriptor && imgSrcDescriptor.set) {
    const originalSrcSetter = imgSrcDescriptor.set;
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...imgSrcDescriptor,
      set(value: string) {
        // Debug: log ALL img.src calls to see what's being set
        console.log(
          '[Sandbox] img.src setter:',
          value?.substring?.(0, 100) || value,
        );

        const resolved = resolveResourceUrl(value);
        if (resolved !== value) {
          console.debug(
            '[Sandbox] img.src intercepted:',
            value,
            '->',
            resolved,
          );
        }
        return originalSrcSetter.call(this, resolved);
      },
    });
  }

  // === SCRIPT ELEMENT INTERCEPTION ===
  const scriptSrcDescriptor = Object.getOwnPropertyDescriptor(
    HTMLScriptElement.prototype,
    'src',
  );
  if (scriptSrcDescriptor && scriptSrcDescriptor.set) {
    const originalScriptSrcSetter = scriptSrcDescriptor.set;
    Object.defineProperty(HTMLScriptElement.prototype, 'src', {
      ...scriptSrcDescriptor,
      set(value: string) {
        const resolved = resolveResourceUrl(value);
        if (resolved !== value) {
          console.debug(
            '[Sandbox] script.src intercepted:',
            value,
            '->',
            resolved,
          );
        }
        return originalScriptSrcSetter.call(this, resolved);
      },
    });
  }

  // === LINK ELEMENT INTERCEPTION (for CSS) ===
  const linkHrefDescriptor = Object.getOwnPropertyDescriptor(
    HTMLLinkElement.prototype,
    'href',
  );
  if (linkHrefDescriptor && linkHrefDescriptor.set) {
    const originalLinkHrefSetter = linkHrefDescriptor.set;
    Object.defineProperty(HTMLLinkElement.prototype, 'href', {
      ...linkHrefDescriptor,
      set(value: string) {
        const resolved = resolveResourceUrl(value);
        if (resolved !== value) {
          console.debug(
            '[Sandbox] link.href intercepted:',
            value,
            '->',
            resolved,
          );
        }
        return originalLinkHrefSetter.call(this, resolved);
      },
    });
  }

  // === AUDIO/VIDEO ELEMENT INTERCEPTION ===
  const mediaSrcDescriptor = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    'src',
  );
  if (mediaSrcDescriptor && mediaSrcDescriptor.set) {
    const originalMediaSrcSetter = mediaSrcDescriptor.set;
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      ...mediaSrcDescriptor,
      set(value: string) {
        const resolved = resolveResourceUrl(value);
        if (resolved !== value) {
          console.debug(
            '[Sandbox] media.src intercepted:',
            value,
            '->',
            resolved,
          );
        }
        return originalMediaSrcSetter.call(this, resolved);
      },
    });
  }

  // === SOURCE ELEMENT INTERCEPTION (for picture/video/audio sources) ===
  const sourceSrcDescriptor = Object.getOwnPropertyDescriptor(
    HTMLSourceElement.prototype,
    'src',
  );
  if (sourceSrcDescriptor && sourceSrcDescriptor.set) {
    const originalSourceSrcSetter = sourceSrcDescriptor.set;
    Object.defineProperty(HTMLSourceElement.prototype, 'src', {
      ...sourceSrcDescriptor,
      set(value: string) {
        const resolved = resolveResourceUrl(value);
        if (resolved !== value) {
          console.debug(
            '[Sandbox] source.src intercepted:',
            value,
            '->',
            resolved,
          );
        }
        return originalSourceSrcSetter.call(this, resolved);
      },
    });
  }

  // === WORKER INTERCEPTION ===
  const OriginalWorker = window.Worker;
  (window as any).Worker = function (
    scriptURL: string | URL,
    options?: WorkerOptions,
  ): Worker {
    const urlStr = scriptURL instanceof URL ? scriptURL.href : scriptURL;
    const resolved = resolveResourceUrl(urlStr);
    if (resolved !== urlStr) {
      console.debug('[Sandbox] Worker intercepted:', urlStr, '->', resolved);
      return new OriginalWorker(resolved, options);
    }
    return new OriginalWorker(scriptURL, options);
  };
  (window as any).Worker.prototype = OriginalWorker.prototype;

  // === DYNAMIC IMPORT INTERCEPTION ===
  // Note: We can't directly intercept import(), but we can provide a helper
  (window as any).__wayfinderImport = async (path: string) => {
    const resolved = resolveResourceUrl(path);
    console.debug('[Sandbox] dynamic import:', path, '->', resolved);
    return import(/* @vite-ignore */ resolved);
  };

  // === SETATTRIBUTE INTERCEPTION ===
  // Webpack and other bundlers may use setAttribute instead of property setters
  const originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (
    name: string,
    value: string,
  ): void {
    // Intercept src, href, data, action, poster, and srcset attributes
    const attrName = name.toLowerCase();
    if (
      (attrName === 'src' ||
        attrName === 'href' ||
        attrName === 'data' ||
        attrName === 'action' ||
        attrName === 'poster') &&
      typeof value === 'string'
    ) {
      const tagName = this.tagName?.toLowerCase();
      // List of elements that can have URL attributes
      const urlElements = [
        'script',
        'img',
        'link',
        'audio',
        'video',
        'source',
        'iframe',
        'embed',
        'object',
        'track',
        'form',
        'a',
        'area',
        'base',
        'input',
        'use',
        'image',
      ];
      if (urlElements.includes(tagName)) {
        const resolved = resolveResourceUrl(value);
        if (resolved !== value) {
          console.debug(
            `[Sandbox] ${tagName}.setAttribute('${name}') intercepted:`,
            value,
            '->',
            resolved,
          );
          return originalSetAttribute.call(this, name, resolved);
        }
      }
    }
    // Handle srcset which contains multiple URLs
    if (attrName === 'srcset' && typeof value === 'string') {
      const resolved = value
        .split(',')
        .map((entry) => {
          const parts = entry.trim().split(/\s+/);
          if (parts.length > 0) {
            parts[0] = resolveResourceUrl(parts[0]);
          }
          return parts.join(' ');
        })
        .join(', ');
      if (resolved !== value) {
        console.debug(
          `[Sandbox] ${this.tagName?.toLowerCase()}.setAttribute('srcset') intercepted`,
        );
        return originalSetAttribute.call(this, name, resolved);
      }
    }
    return originalSetAttribute.call(this, name, value);
  };

  // === APPENDCHILD/INSERTBEFORE INTERCEPTION ===
  // This is critical for catching webpack's dynamic script loading
  // Webpack creates a script element and appends it to head/body
  const originalAppendChild = Node.prototype.appendChild;
  Node.prototype.appendChild = function <T extends Node>(node: T): T {
    // Intercept script elements being added
    if (node instanceof HTMLScriptElement && node.src) {
      const resolved = resolveResourceUrl(node.src);
      if (resolved !== node.src) {
        console.debug(
          '[Sandbox] appendChild script intercepted:',
          node.src,
          '->',
          resolved,
        );
        node.src = resolved;
      }
    }
    return originalAppendChild.call(this, node) as T;
  };

  const originalInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(
    node: T,
    child: Node | null,
  ): T {
    // Intercept script elements being added
    if (node instanceof HTMLScriptElement && node.src) {
      const resolved = resolveResourceUrl(node.src);
      if (resolved !== node.src) {
        console.debug(
          '[Sandbox] insertBefore script intercepted:',
          node.src,
          '->',
          resolved,
        );
        node.src = resolved;
      }
    }
    return originalInsertBefore.call(this, node, child) as T;
  };

  // === IFRAME ELEMENT INTERCEPTION ===
  const iframeSrcDescriptor = Object.getOwnPropertyDescriptor(
    HTMLIFrameElement.prototype,
    'src',
  );
  if (iframeSrcDescriptor && iframeSrcDescriptor.set) {
    const originalIframeSrcSetter = iframeSrcDescriptor.set;
    Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
      ...iframeSrcDescriptor,
      set(value: string) {
        const resolved = resolveResourceUrl(value);
        if (resolved !== value) {
          console.debug(
            '[Sandbox] iframe.src intercepted:',
            value,
            '->',
            resolved,
          );
        }
        return originalIframeSrcSetter.call(this, resolved);
      },
    });
  }

  // === EMBED ELEMENT INTERCEPTION ===
  const embedSrcDescriptor = Object.getOwnPropertyDescriptor(
    HTMLEmbedElement.prototype,
    'src',
  );
  if (embedSrcDescriptor && embedSrcDescriptor.set) {
    const originalEmbedSrcSetter = embedSrcDescriptor.set;
    Object.defineProperty(HTMLEmbedElement.prototype, 'src', {
      ...embedSrcDescriptor,
      set(value: string) {
        const resolved = resolveResourceUrl(value);
        if (resolved !== value) {
          console.debug(
            '[Sandbox] embed.src intercepted:',
            value,
            '->',
            resolved,
          );
        }
        return originalEmbedSrcSetter.call(this, resolved);
      },
    });
  }

  // === OBJECT ELEMENT INTERCEPTION ===
  const objectDataDescriptor = Object.getOwnPropertyDescriptor(
    HTMLObjectElement.prototype,
    'data',
  );
  if (objectDataDescriptor && objectDataDescriptor.set) {
    const originalObjectDataSetter = objectDataDescriptor.set;
    Object.defineProperty(HTMLObjectElement.prototype, 'data', {
      ...objectDataDescriptor,
      set(value: string) {
        const resolved = resolveResourceUrl(value);
        if (resolved !== value) {
          console.debug(
            '[Sandbox] object.data intercepted:',
            value,
            '->',
            resolved,
          );
        }
        return originalObjectDataSetter.call(this, resolved);
      },
    });
  }

  // === TRACK ELEMENT INTERCEPTION (subtitles/captions) ===
  const trackSrcDescriptor = Object.getOwnPropertyDescriptor(
    HTMLTrackElement.prototype,
    'src',
  );
  if (trackSrcDescriptor && trackSrcDescriptor.set) {
    const originalTrackSrcSetter = trackSrcDescriptor.set;
    Object.defineProperty(HTMLTrackElement.prototype, 'src', {
      ...trackSrcDescriptor,
      set(value: string) {
        const resolved = resolveResourceUrl(value);
        if (resolved !== value) {
          console.debug(
            '[Sandbox] track.src intercepted:',
            value,
            '->',
            resolved,
          );
        }
        return originalTrackSrcSetter.call(this, resolved);
      },
    });
  }

  // === FORM ACTION INTERCEPTION ===
  const formActionDescriptor = Object.getOwnPropertyDescriptor(
    HTMLFormElement.prototype,
    'action',
  );
  if (formActionDescriptor && formActionDescriptor.set) {
    const originalFormActionSetter = formActionDescriptor.set;
    Object.defineProperty(HTMLFormElement.prototype, 'action', {
      ...formActionDescriptor,
      set(value: string) {
        const resolved = resolveResourceUrl(value);
        if (resolved !== value) {
          console.debug(
            '[Sandbox] form.action intercepted:',
            value,
            '->',
            resolved,
          );
        }
        return originalFormActionSetter.call(this, resolved);
      },
    });
  }

  // === ANCHOR HREF INTERCEPTION ===
  const anchorHrefDescriptor = Object.getOwnPropertyDescriptor(
    HTMLAnchorElement.prototype,
    'href',
  );
  if (anchorHrefDescriptor && anchorHrefDescriptor.set) {
    const originalAnchorHrefSetter = anchorHrefDescriptor.set;
    Object.defineProperty(HTMLAnchorElement.prototype, 'href', {
      ...anchorHrefDescriptor,
      set(value: string) {
        const resolved = resolveResourceUrl(value);
        if (resolved !== value) {
          console.debug('[Sandbox] a.href intercepted:', value, '->', resolved);
        }
        return originalAnchorHrefSetter.call(this, resolved);
      },
    });
  }

  // === AREA HREF INTERCEPTION (image maps) ===
  const areaHrefDescriptor = Object.getOwnPropertyDescriptor(
    HTMLAreaElement.prototype,
    'href',
  );
  if (areaHrefDescriptor && areaHrefDescriptor.set) {
    const originalAreaHrefSetter = areaHrefDescriptor.set;
    Object.defineProperty(HTMLAreaElement.prototype, 'href', {
      ...areaHrefDescriptor,
      set(value: string) {
        const resolved = resolveResourceUrl(value);
        if (resolved !== value) {
          console.debug(
            '[Sandbox] area.href intercepted:',
            value,
            '->',
            resolved,
          );
        }
        return originalAreaHrefSetter.call(this, resolved);
      },
    });
  }

  // === BASE HREF INTERCEPTION ===
  // Block base href changes as they can break our URL resolution
  const baseHrefDescriptor = Object.getOwnPropertyDescriptor(
    HTMLBaseElement.prototype,
    'href',
  );
  if (baseHrefDescriptor && baseHrefDescriptor.set) {
    Object.defineProperty(HTMLBaseElement.prototype, 'href', {
      ...baseHrefDescriptor,
      set(value: string) {
        console.debug('[Sandbox] base.href intercepted (blocked):', value);
        // Intentionally don't set - base href can break our URL resolution
      },
    });
  }

  // === SHARED WORKER INTERCEPTION ===
  if (typeof SharedWorker !== 'undefined') {
    const OriginalSharedWorker = SharedWorker;
    (window as any).SharedWorker = function (
      scriptURL: string | URL,
      options?: string | WorkerOptions,
    ): SharedWorker {
      const urlStr = scriptURL instanceof URL ? scriptURL.href : scriptURL;
      const resolved = resolveResourceUrl(urlStr);
      if (resolved !== urlStr) {
        console.debug(
          '[Sandbox] SharedWorker intercepted:',
          urlStr,
          '->',
          resolved,
        );
        return new OriginalSharedWorker(resolved, options);
      }
      return new OriginalSharedWorker(scriptURL, options);
    };
    (window as any).SharedWorker.prototype = OriginalSharedWorker.prototype;
  }

  // === EVENT SOURCE INTERCEPTION (Server-Sent Events) ===
  if (typeof EventSource !== 'undefined') {
    const OriginalEventSource = EventSource;
    (window as any).EventSource = function (
      url: string | URL,
      eventSourceInitDict?: EventSourceInit,
    ): EventSource {
      const urlStr = url instanceof URL ? url.href : url;
      const resolved = resolveResourceUrl(urlStr);
      if (resolved !== urlStr) {
        console.debug(
          '[Sandbox] EventSource intercepted:',
          urlStr,
          '->',
          resolved,
        );
        return new OriginalEventSource(resolved, eventSourceInitDict);
      }
      return new OriginalEventSource(url, eventSourceInitDict);
    };
    (window as any).EventSource.prototype = OriginalEventSource.prototype;
    (window as any).EventSource.CONNECTING = OriginalEventSource.CONNECTING;
    (window as any).EventSource.OPEN = OriginalEventSource.OPEN;
    (window as any).EventSource.CLOSED = OriginalEventSource.CLOSED;
  }

  // === NAVIGATOR.SENDBEACON INTERCEPTION ===
  if (navigator.sendBeacon) {
    const originalSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (
      url: string | URL,
      data?: BodyInit | null,
    ): boolean {
      const urlStr = url instanceof URL ? url.href : url;
      const resolved = resolveResourceUrl(urlStr);
      if (resolved !== urlStr) {
        console.debug(
          '[Sandbox] sendBeacon intercepted:',
          urlStr,
          '->',
          resolved,
        );
        return originalSendBeacon(resolved, data);
      }
      return originalSendBeacon(url, data);
    };
  }

  // === WINDOW.OPEN INTERCEPTION ===
  const originalWindowOpen = window.open;
  window.open = function (
    url?: string | URL,
    target?: string,
    features?: string,
  ): Window | null {
    if (url) {
      const urlStr = url instanceof URL ? url.href : url;
      const resolved = resolveResourceUrl(urlStr);
      if (resolved !== urlStr) {
        console.debug(
          '[Sandbox] window.open intercepted:',
          urlStr,
          '->',
          resolved,
        );
        return originalWindowOpen.call(this, resolved, target, features);
      }
    }
    return originalWindowOpen.call(this, url, target, features);
  };

  // === LOCATION INTERCEPTION ===
  // These are tricky because location is a special object
  // We intercept assign and replace methods
  const originalLocationAssign = location.assign.bind(location);
  location.assign = function (url: string | URL): void {
    const urlStr = url instanceof URL ? url.href : url;
    const resolved = resolveResourceUrl(urlStr);
    if (resolved !== urlStr) {
      console.debug(
        '[Sandbox] location.assign intercepted:',
        urlStr,
        '->',
        resolved,
      );
      return originalLocationAssign(resolved);
    }
    return originalLocationAssign(url);
  };

  const originalLocationReplace = location.replace.bind(location);
  location.replace = function (url: string | URL): void {
    const urlStr = url instanceof URL ? url.href : url;
    const resolved = resolveResourceUrl(urlStr);
    if (resolved !== urlStr) {
      console.debug(
        '[Sandbox] location.replace intercepted:',
        urlStr,
        '->',
        resolved,
      );
      return originalLocationReplace(resolved);
    }
    return originalLocationReplace(url);
  };

  // === DOCUMENT.WRITE / DOCUMENT.WRITELN INTERCEPTION ===
  // These can inject HTML with resource URLs
  const originalDocumentWrite = document.write.bind(document);
  document.write = function (...args: string[]): void {
    const rewrittenArgs = args.map((html) => {
      if (typeof html === 'string') {
        return rewriteResourceUrls(html);
      }
      return html;
    });
    return originalDocumentWrite(...rewrittenArgs);
  };

  const originalDocumentWriteln = document.writeln.bind(document);
  document.writeln = function (...args: string[]): void {
    const rewrittenArgs = args.map((html) => {
      if (typeof html === 'string') {
        return rewriteResourceUrls(html);
      }
      return html;
    });
    return originalDocumentWriteln(...rewrittenArgs);
  };

  // === CSS STYLESHEET INSERTULE INTERCEPTION ===
  const originalInsertRule = CSSStyleSheet.prototype.insertRule;
  CSSStyleSheet.prototype.insertRule = function (
    rule: string,
    index?: number,
  ): number {
    const rewrittenRule = rewriteCssUrls(rule);
    if (rewrittenRule !== rule) {
      console.debug('[Sandbox] CSSStyleSheet.insertRule intercepted');
    }
    return originalInsertRule.call(this, rewrittenRule, index);
  };

  // === CSSSTYLEDECLARATION INTERCEPTION ===
  // Intercept setting of style properties that can contain URLs
  const urlStyleProperties = [
    'background',
    'backgroundImage',
    'borderImage',
    'borderImageSource',
    'listStyle',
    'listStyleImage',
    'content',
    'cursor',
    'filter',
    'maskImage',
    'mask',
    'src', // for @font-face
  ];

  const originalSetProperty = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function (
    property: string,
    value: string | null,
    priority?: string,
  ): void {
    if (
      value &&
      urlStyleProperties.some((p) =>
        property.toLowerCase().includes(p.toLowerCase()),
      )
    ) {
      const rewritten = rewriteCssUrls(value);
      if (rewritten !== value) {
        console.debug('[Sandbox] style.setProperty intercepted:', property);
      }
      return originalSetProperty.call(this, property, rewritten, priority);
    }
    return originalSetProperty.call(this, property, value, priority);
  };

  // Intercept direct style property assignment for common URL-containing properties
  const styleProto = CSSStyleDeclaration.prototype;

  // Helper to create style property interceptor
  const interceptStyleProperty = (propName: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(styleProto, propName);
    if (descriptor && descriptor.set) {
      const originalSetter = descriptor.set;
      Object.defineProperty(styleProto, propName, {
        ...descriptor,
        set(value: string) {
          const rewritten = rewriteCssUrls(value);
          if (rewritten !== value) {
            console.debug(`[Sandbox] style.${propName} intercepted`);
          }
          return originalSetter.call(this, rewritten);
        },
      });
    }
  };

  // Intercept common URL-containing style properties
  [
    'background',
    'backgroundImage',
    'borderImage',
    'borderImageSource',
    'listStyle',
    'listStyleImage',
    'cursor',
    'content',
  ].forEach(interceptStyleProperty);

  // NOTE: SVG href interception (SVGImageElement, SVGUseElement) is not implemented.
  // SVG uses SVGAnimatedString which requires intercepting baseVal.baseVal setter,
  // which is complex. Most SVG content is rewritten via innerHTML/setAttribute handlers.

  // === INNERHTML INTERCEPTION ===
  // Intercept innerHTML to rewrite URLs in injected HTML
  const originalInnerHTMLDescriptor = Object.getOwnPropertyDescriptor(
    Element.prototype,
    'innerHTML',
  );
  if (originalInnerHTMLDescriptor && originalInnerHTMLDescriptor.set) {
    const originalInnerHTMLSetter = originalInnerHTMLDescriptor.set;
    Object.defineProperty(Element.prototype, 'innerHTML', {
      ...originalInnerHTMLDescriptor,
      set(value: string) {
        if (typeof value === 'string') {
          const rewritten = rewriteResourceUrls(value);
          return originalInnerHTMLSetter.call(this, rewritten);
        }
        return originalInnerHTMLSetter.call(this, value);
      },
    });
  }

  // === OUTERHTML INTERCEPTION ===
  const originalOuterHTMLDescriptor = Object.getOwnPropertyDescriptor(
    Element.prototype,
    'outerHTML',
  );
  if (originalOuterHTMLDescriptor && originalOuterHTMLDescriptor.set) {
    const originalOuterHTMLSetter = originalOuterHTMLDescriptor.set;
    Object.defineProperty(Element.prototype, 'outerHTML', {
      ...originalOuterHTMLDescriptor,
      set(value: string) {
        if (typeof value === 'string') {
          const rewritten = rewriteResourceUrls(value);
          return originalOuterHTMLSetter.call(this, rewritten);
        }
        return originalOuterHTMLSetter.call(this, value);
      },
    });
  }

  // === INSERTADJACENTHTML INTERCEPTION ===
  const originalInsertAdjacentHTML = Element.prototype.insertAdjacentHTML;
  Element.prototype.insertAdjacentHTML = function (
    position: InsertPosition,
    text: string,
  ): void {
    const rewritten = rewriteResourceUrls(text);
    return originalInsertAdjacentHTML.call(this, position, rewritten);
  };

  // === DOMPARSER INTERCEPTION ===
  const OriginalDOMParser = DOMParser;
  (window as any).DOMParser = class extends OriginalDOMParser {
    parseFromString(string: string, type: DOMParserSupportedType): Document {
      if (type === 'text/html' || type === 'application/xhtml+xml') {
        string = rewriteResourceUrls(string);
      }
      return super.parseFromString(string, type);
    }
  };

  console.log('[Sandbox] URL interceptors installed (comprehensive)');
}

/**
 * Resolve a relative URL to a blob URL if available.
 * Returns the original URL if not found in our resource map.
 */
function resolveResourceUrl(url: string): string {
  // Skip absolute URLs (but not chrome-extension:// which we may need to intercept)
  if (/^(https?:\/\/|\/\/|data:|blob:|javascript:)/i.test(url)) {
    return url;
  }

  // Handle chrome-extension:// URLs that should be resources
  // This happens when webpack or other bundlers construct absolute URLs
  if (url.startsWith('chrome-extension://')) {
    // Extract the path portion after the extension ID
    const match = url.match(/chrome-extension:\/\/[^/]+\/(.+)/);
    if (match) {
      const path = match[1];
      // Try to resolve this path
      const resolved = resolveResourceUrl(path);
      if (resolved !== path) {
        return resolved;
      }
    }
    // If we can't resolve it, return original
    return url;
  }

  // Normalize the path
  let normalizedPath = url;

  // Handle malformed paths like "/null/..." that webpack may generate
  // when public path is misconfigured in sandbox context
  if (normalizedPath.startsWith('/null/')) {
    normalizedPath = normalizedPath.slice(6); // Remove '/null/'
  }

  if (normalizedPath.startsWith('./')) {
    normalizedPath = normalizedPath.slice(2);
  }
  if (normalizedPath.startsWith('/')) {
    normalizedPath = normalizedPath.slice(1);
  }

  // Look up blob URL - try multiple variations
  const blobUrl =
    resourceBlobUrls.get(normalizedPath) ||
    resourceBlobUrls.get('/' + normalizedPath) ||
    resourceBlobUrls.get('./' + normalizedPath);

  if (blobUrl) {
    return blobUrl;
  }

  // Debug: if this looks like a resource path, log why lookup failed
  if (normalizedPath.includes('splash') || normalizedPath.includes('Icon')) {
    console.warn('[Sandbox] Resource lookup failed for:', normalizedPath);
    console.warn('[Sandbox] Tried keys:', [
      normalizedPath,
      '/' + normalizedPath,
      './' + normalizedPath,
    ]);
    console.warn(
      '[Sandbox] Map has key?',
      resourceBlobUrls.has(normalizedPath),
      resourceBlobUrls.has('/' + normalizedPath),
    );
    console.warn('[Sandbox] Map size:', resourceBlobUrls.size);
  }

  // For webpack/bundler chunk files, try to find by filename pattern
  // e.g., "8373.bundle.js" might be stored as "static/js/8373.bundle.js"
  // Also handle patterns like "1947.bundle.js", "chunk-abc123.js", etc.
  const chunkPatterns = [
    /^\d+\.bundle\.js$/, // 8373.bundle.js
    /^\d+\.[a-f0-9]+\.chunk\.js$/, // 123.abc123.chunk.js
    /^chunk-[a-f0-9]+\.js$/, // chunk-abc123.js
    /^\d+\.[a-f0-9]+\.js$/, // 123.abc123.js
    /^[a-f0-9]+\.js$/, // abc123.js (content-hashed)
  ];

  const isChunkFile = chunkPatterns.some((pattern) =>
    pattern.test(normalizedPath),
  );

  if (isChunkFile) {
    for (const [path, blobUrl] of resourceBlobUrls.entries()) {
      if (
        path.endsWith('/' + normalizedPath) ||
        path.endsWith(normalizedPath)
      ) {
        console.debug(
          '[Sandbox] Matched chunk file:',
          normalizedPath,
          '->',
          path,
        );
        return blobUrl;
      }
    }
  }

  // Last resort: try fuzzy matching by filename only (for any file type)
  const filename = normalizedPath.split('/').pop();
  if (filename) {
    for (const [path, blobUrl] of resourceBlobUrls.entries()) {
      const storedFilename = path.split('/').pop();
      if (storedFilename === filename) {
        console.debug(
          '[Sandbox] Fuzzy matched by filename:',
          normalizedPath,
          '->',
          path,
        );
        return blobUrl;
      }
    }
  }

  // Debug: log unresolved URLs that might be resources
  if (
    !url.startsWith('http') &&
    !url.startsWith('//') &&
    !url.startsWith('data:') &&
    !url.startsWith('blob:')
  ) {
    // Check if this path exists anywhere in our map (case-insensitive search)
    const allPaths = Array.from(resourceBlobUrls.keys());
    const matchingPaths = allPaths.filter(
      (p) =>
        p.toLowerCase().includes(normalizedPath.toLowerCase()) ||
        normalizedPath
          .toLowerCase()
          .includes(p.toLowerCase().split('/').pop() || ''),
    );
    console.debug(
      '[Sandbox] Unresolved URL:',
      url,
      '(normalized:',
      normalizedPath,
      ')',
    );
    console.debug(
      '[Sandbox] Total resources:',
      allPaths.length,
      'Similar paths found:',
      matchingPaths,
    );
  }

  return url;
}

/**
 * Rewrite resource URLs in HTML to use blob URLs
 */
function rewriteResourceUrls(html: string): string {
  console.log(
    '[Sandbox] rewriteResourceUrls called, map size:',
    resourceBlobUrls.size,
  );

  // Match src="..." and href="..." attributes
  let result = html.replace(
    /((?:src|href)\s*=\s*["'])([^"']+)(["'])/gi,
    (match, prefix, url, suffix) => {
      const resolved = resolveResourceUrl(url);
      if (url.includes('splash')) {
        console.log(
          '[Sandbox] HTML rewrite - splash URL:',
          url,
          '-> resolved:',
          resolved !== url ? 'YES' : 'NO (unchanged)',
        );
      }
      return resolved !== url ? prefix + resolved + suffix : match;
    },
  );

  // Also rewrite CSS url() references in style attributes and style tags
  result = rewriteCssUrls(result);

  return result;
}

/**
 * Rewrite CSS url() references to use blob URLs
 */
function rewriteCssUrls(content: string): string {
  // Match url(...) in CSS - handles both quoted and unquoted URLs
  return content.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
    (match, quote, url) => {
      const resolved = resolveResourceUrl(url);
      return resolved !== url ? `url(${quote}${resolved}${quote})` : match;
    },
  );
}

/**
 * Extract script tags from HTML and return them separately
 */
function extractScripts(html: string): { html: string; scripts: ScriptInfo[] } {
  const scripts: ScriptInfo[] = [];

  // Match script tags
  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

  const cleanHtml = html.replace(scriptRegex, (_match, attrs, content) => {
    const srcMatch = attrs.match(/src\s*=\s*["']([^"']+)["']/i);
    const typeMatch = attrs.match(/type\s*=\s*["']([^"']+)["']/i);

    scripts.push({
      src: srcMatch ? srcMatch[1] : null,
      content: content || '',
      type: typeMatch ? typeMatch[1] : null,
      attrs: attrs,
    });

    // Replace with placeholder comment
    return `<!-- script ${scripts.length - 1} -->`;
  });

  return { html: cleanHtml, scripts };
}

interface ScriptInfo {
  src: string | null;
  content: string;
  type: string | null;
  attrs: string;
}

// Track the currently executing script's original src for document.currentScript mock
let currentExecutingScriptSrc: string | null = null;

/**
 * Execute scripts in order
 */
async function executeScripts(scripts: ScriptInfo[]): Promise<void> {
  console.log(`[Sandbox] Executing ${scripts.length} scripts in order`);
  for (let i = 0; i < scripts.length; i++) {
    const script = scripts[i];
    const scriptName = script.src || `inline-${i}`;
    console.log(
      `[Sandbox] Executing script ${i + 1}/${scripts.length}: ${scriptName}`,
    );
    try {
      await executeScript(script);
      console.log(`[Sandbox] Script completed: ${scriptName}`);
    } catch (error) {
      console.error(`[Sandbox] Script ${scriptName} error:`, error);
    }
  }
  console.log('[Sandbox] All scripts executed');
}

/**
 * Execute a single script
 *
 * Note: We use saved native function references to avoid issues when loaded
 * scripts (e.g., Flutter's dart2js output) modify prototypes like
 * String.prototype, Map.prototype, or Function.prototype.
 */
async function executeScript(script: ScriptInfo): Promise<void> {
  return new Promise(function promiseExecutor(resolve, _reject) {
    let scriptEl: HTMLScriptElement;

    try {
      // Use saved native reference
      scriptEl = nativeCreateElement('script') as HTMLScriptElement;
    } catch (e) {
      console.error('[Sandbox] Failed to create script element:', e);
      resolve();
      return;
    }

    // Copy type if present
    if (script.type) {
      try {
        scriptEl.type = script.type;
      } catch (e) {
        console.warn('[Sandbox] Could not set script type:', e);
      }
    }

    if (script.src) {
      // External script - check if we have a blob URL
      let src = script.src;
      const originalSrc = script.src;

      // For external URLs (http/https/blob/data), use as-is
      // Only do blob URL lookup for relative paths
      // Use saved native RegExp.prototype.test
      const externalUrlPattern = /^(https?:\/\/|\/\/|data:|blob:)/i;
      const isExternalUrl = nativeRegExpTest.call(externalUrlPattern, src);

      if (!isExternalUrl) {
        // Normalize path for internal resources
        // Use saved native String methods
        let normalizedPath = src;
        if (nativeStringIndexOf.call(normalizedPath, './') === 0) {
          normalizedPath = nativeStringSubstring.call(normalizedPath, 2);
        }
        if (nativeStringIndexOf.call(normalizedPath, '/') === 0) {
          normalizedPath = nativeStringSubstring.call(normalizedPath, 1);
        }

        // Look up blob URL using saved native Map.prototype.get
        const blobUrl =
          nativeMapGet.call(resourceBlobUrls, normalizedPath) ||
          nativeMapGet.call(resourceBlobUrls, '/' + normalizedPath);

        if (blobUrl) {
          src = blobUrl;
        } else {
          // Relative URL without blob - skip it
          console.warn('[Sandbox] Skipping script without blob URL:', src);
          resolve();
          return;
        }
      }

      // Set the original src for document.currentScript mock
      // Only set for internal paths, not external URLs
      if (!isExternalUrl) {
        currentExecutingScriptSrc =
          nativeStringIndexOf.call(originalSrc, '/') === 0
            ? originalSrc
            : '/' + originalSrc;
      } else {
        // For external URLs, set the full URL
        currentExecutingScriptSrc = originalSrc;
      }

      try {
        scriptEl.src = src;

        // Use function expressions to avoid arrow function issues
        scriptEl.onload = function onScriptLoad() {
          currentExecutingScriptSrc = null;
          resolve();
        };

        scriptEl.onerror = function onScriptError(_e: Event | string) {
          console.error('[Sandbox] Failed to load script:', src);
          currentExecutingScriptSrc = null;
          resolve(); // Continue even on error
        };

        // Use saved native appendChild
        nativeAppendChild.call(document.body, scriptEl);
      } catch (e) {
        console.error('[Sandbox] Error setting up script:', src, e);
        currentExecutingScriptSrc = null;
        resolve();
      }
    } else if (script.content) {
      // Inline script
      currentExecutingScriptSrc = null;

      try {
        scriptEl.textContent = script.content;
        // Use saved native appendChild
        nativeAppendChild.call(document.body, scriptEl);
      } catch (e) {
        console.error('[Sandbox] Error executing inline script:', e);
      }

      resolve();
    } else {
      resolve();
    }
  });
}

/**
 * Handle adding a new resource (for lazy loading)
 */
function handleAddResource(data: {
  path: string;
  data: ArrayBuffer;
  contentType: string;
}): void {
  const blob = new Blob([data.data], { type: data.contentType });
  const blobUrl = URL.createObjectURL(blob);
  blobUrls.push(blobUrl);
  resourceBlobUrls.set(data.path, blobUrl);

  if (!data.path.startsWith('/')) {
    resourceBlobUrls.set('/' + data.path, blobUrl);
  }
}

/**
 * Clear all content and cleanup blob URLs
 */
function handleClearContent(): void {
  const container = document.getElementById('sandbox-content');
  if (container) {
    container.innerHTML = '';
    container.classList.add('loading');
    container.textContent = 'Waiting for verified content...';
  }

  // Cleanup blob URLs
  for (const url of blobUrls) {
    URL.revokeObjectURL(url);
  }
  blobUrls.length = 0;
  resourceBlobUrls.clear();
  currentIdentifier = null;
}

// Initialize
init();
