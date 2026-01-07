/**
 * WayFinder Extension - Location Patch Script
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc.
 *
 * Licensed under the Apache License, Version 2.0
 *
 * This script is loaded externally into verified content iframes.
 * It rewrites the URL from /ar-proxy/{identifier}/ to / so apps
 * that depend on window.location.pathname work correctly.
 *
 * The patch data is passed via a data attribute on the <html> element.
 */

(function () {
  // Read patch data from the html element
  const htmlEl = document.documentElement;
  const patchData = htmlEl.getAttribute('data-wayfinder-patch');

  if (!patchData) {
    console.warn('[Wayfinder] No patch data found');
    return;
  }

  let config: { identifier: string; gateway: string };
  try {
    config = JSON.parse(patchData);
  } catch (e) {
    console.warn('[Wayfinder] Failed to parse patch data:', e);
    return;
  }

  const proxyPrefix = `/ar-proxy/${config.identifier}`;
  const originalPathname = window.location.pathname;
  const originalHref = window.location.href;

  // Calculate what the pathname should be without the proxy prefix
  let newPathname = '/';
  if (originalPathname.startsWith(proxyPrefix)) {
    newPathname = originalPathname.slice(proxyPrefix.length) || '/';
  }

  // Use history.replaceState to actually change the URL
  if (originalPathname !== newPathname) {
    try {
      const newUrl =
        newPathname + window.location.search + window.location.hash;
      history.replaceState(history.state, '', newUrl);
      console.log(
        '[Wayfinder] URL rewritten:',
        originalPathname,
        '->',
        newPathname,
      );
    } catch (e) {
      console.warn('[Wayfinder] Could not rewrite URL:', e);
    }
  }

  // Store debug info
  (window as any).__wayfinderDebug = {
    originalPathname,
    originalHref,
    rewrittenPathname: window.location.pathname,
    identifier: config.identifier,
    gateway: config.gateway,
    simulatedHost: `${config.identifier}.${config.gateway}`,
  };

  // Expose helper for apps that want gateway info
  (window as any).__wayfinderContext = {
    identifier: config.identifier,
    gateway: config.gateway,
    simulatedOrigin: `https://${config.identifier}.${config.gateway}`,
  };
})();
