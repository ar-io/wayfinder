/**
 * WayFinder Extension - Location Patcher
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc.
 *
 * Licensed under the Apache License, Version 2.0
 *
 * Location Patcher for Verified Content.
 *
 * Apps loaded via /ar-proxy/{identifier}/ see a different window.location
 * than they would if loaded directly from a gateway subdomain.
 *
 * This module injects a data attribute and external script reference into HTML
 * responses that patches window.location to make the app think it's running
 * at {identifier}.{gateway-host}
 *
 * NOTE: We use an external script file (location-patch.js) instead of inline
 * script because Chrome extensions have a strict CSP that blocks inline scripts.
 * The patch data is passed via a data-wayfinder-patch attribute on the <html> element.
 */

import { logger } from './logger';

const TAG = 'LocationPatcher';

/**
 * Escape a string for safe use in HTML attribute values.
 * Prevents XSS via identifier injection.
 */
function escapeHtmlAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Inject location patch into HTML content.
 * Returns the modified HTML with:
 * 1. A data-wayfinder-patch attribute on the <html> element containing config
 * 2. A <script src="location-patch.js"> reference to the external patch script
 *
 * The external script reads the config from the data attribute and performs
 * the URL rewriting via history.replaceState().
 */
export function injectLocationPatch(
  html: string,
  identifier: string,
  gatewayUrl: string,
): string {
  // Parse the gateway URL to get the host
  let gatewayHost: string;
  try {
    gatewayHost = new URL(gatewayUrl).host;
  } catch {
    gatewayHost = 'arweave.net';
  }

  // Create the patch config as JSON
  const patchConfig = JSON.stringify({
    identifier,
    gateway: gatewayHost,
  });
  const safePatchConfig = escapeHtmlAttr(patchConfig);

  // The script tag referencing the external patch script
  // chrome.runtime.getURL is not available here, but since we're serving
  // from the extension origin, we can use a relative path
  const scriptTag =
    '<script src="/location-patch.js" data-wayfinder-loader></script>';

  // First, add the data attribute to the <html> tag
  let result = html;
  const htmlMatch = result.match(/<html([^>]*)>/i);
  if (htmlMatch && htmlMatch.index !== undefined) {
    const htmlTag = htmlMatch[0];
    const htmlAttrs = htmlMatch[1] || '';

    // Add the data attribute to the html tag
    const newHtmlTag = `<html${htmlAttrs} data-wayfinder-patch="${safePatchConfig}">`;
    result =
      result.slice(0, htmlMatch.index) +
      newHtmlTag +
      result.slice(htmlMatch.index + htmlTag.length);

    logger.debug(TAG, `Added patch data attribute for ${identifier}`);
  } else {
    // No <html> tag found - prepend a wrapper
    result = `<html data-wayfinder-patch="${safePatchConfig}">` + result;
    logger.warn(
      TAG,
      `No <html> tag found, prepending wrapper for ${identifier}`,
    );
  }

  // Now inject the script tag after <head>
  const headMatch = result.match(/<head[^>]*>/i);
  if (headMatch && headMatch.index !== undefined) {
    const insertPos = headMatch.index + headMatch[0].length;
    result = result.slice(0, insertPos) + scriptTag + result.slice(insertPos);
    logger.debug(TAG, `Injected location patch script for ${identifier}`);
  } else {
    // No <head> tag - try after <html>
    const htmlMatch2 = result.match(/<html[^>]*>/i);
    if (htmlMatch2 && htmlMatch2.index !== undefined) {
      const insertPos = htmlMatch2.index + htmlMatch2[0].length;
      result = result.slice(0, insertPos) + scriptTag + result.slice(insertPos);
      logger.debug(
        TAG,
        `Injected location patch script after html for ${identifier}`,
      );
    }
  }

  return result;
}

/**
 * Check if content type is HTML.
 */
export function isHtmlContent(contentType: string): boolean {
  return contentType.toLowerCase().includes('text/html');
}
