/**
 * WayFinder
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { WayfinderFetchOptions, WayfinderOptions } from '../types.js';

/**
 * Converts WayfinderOptions to WayfinderFetchOptions for use with createWayfinderFetch
 *
 * @param options - WayfinderOptions configuration
 * @returns WayfinderFetchOptions that can be used with createWayfinderFetch
 */
export function convertSettingsToFetchOptions(
  options: WayfinderOptions,
): WayfinderFetchOptions {
  const {
    logger,
    fetch,
    verificationSettings,
    routingSettings,
    dataRetrievalStrategy,
  } = options;

  return {
    logger,
    fetch,
    dataRetrievalStrategy,
    // Extract verification settings
    verificationStrategy: verificationSettings?.strategy,
    strict: verificationSettings?.strict,
    // Extract routing settings
    routingStrategy: routingSettings?.strategy,
    // Extract events from both settings
    events: {
      ...(verificationSettings?.events || {}),
      ...(routingSettings?.events || {}),
    },
    // Note: emitter and tracer are not available in WayfinderOptions
    // They would need to be provided separately if needed
  };
}

/**
 * Checks if the options are WayfinderFetchOptions
 */
export function isWayfinderFetchOptions(
  options: WayfinderOptions | WayfinderFetchOptions,
): options is WayfinderFetchOptions {
  return (
    'verificationStrategy' in options ||
    'routingStrategy' in options ||
    'strict' in options ||
    'emitter' in options ||
    'tracer' in options ||
    'events' in options
  );
}

/**
 * Converts WayfinderFetchOptions to WayfinderOptions for use with Wayfinder constructor
 *
 * @param options - WayfinderFetchOptions configuration
 * @returns WayfinderOptions that can be used with Wayfinder
 */
export function convertFetchOptionsToSettings(
  options: WayfinderFetchOptions,
): WayfinderOptions {
  const {
    logger,
    fetch,
    dataRetrievalStrategy,
    verificationStrategy,
    strict,
    routingStrategy,
    events,
    // Note: emitter and tracer are not part of WayfinderOptions
  } = options;

  const result: WayfinderOptions = {
    logger,
    fetch,
    dataRetrievalStrategy,
  };

  // Convert verification settings if any verification-related options are present
  if (verificationStrategy || strict !== undefined || events) {
    result.verificationSettings = {
      enabled: !!verificationStrategy,
      strategy: verificationStrategy,
      strict,
      events,
    };
  }

  // Convert routing settings if any routing-related options are present
  if (routingStrategy || events) {
    result.routingSettings = {
      strategy: routingStrategy,
      events,
    };
  }

  return result;
}
