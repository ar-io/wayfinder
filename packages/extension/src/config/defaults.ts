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

import {
  ARIO_MAINNET_PROCESS_ID,
  DEFAULT_AO_CU_URL,
  FALLBACK_GATEWAY,
} from '../constants';

/**
 * Core extension defaults
 */
export const EXTENSION_DEFAULTS = {
  // AR.IO Network Configuration
  processId: ARIO_MAINNET_PROCESS_ID,
  aoCuUrl: DEFAULT_AO_CU_URL,

  // Basic Extension Settings
  routingMethod: 'fastestPing',
  blacklistedGateways: [],
  ensResolutionEnabled: true,

  // Storage & Registry
  localGatewayAddressRegistry: {},
  gatewayPerformance: {},

  // Stats Tracking
  dailyStats: {
    date: new Date().toDateString(),
    requestCount: 0,
    totalRequestCount: 0,
    verifiedCount: 0,
    failedCount: 0,
  },
} as const;

/**
 * Wayfinder Core configuration defaults
 */
export const WAYFINDER_DEFAULTS = {
  // Routing Configuration
  routingMethod: 'fastestPing',
  staticGateway: null,

  // Verified Browsing
  verifiedBrowsing: false,

  // Verification Configuration (used when verified browsing is ON)
  verificationStrategy: 'hash',

  // Gateway Management
  gatewayCacheTTL: 3600, // 1 hour in seconds
  gatewaySortBy: 'operatorStake',
  gatewaySortOrder: 'desc',

  // Verification Gateway Selection
  verificationGatewayMode: 'automatic',
  verificationGatewayCount: 3,
  verificationTrustedGateways: [],

  // Telemetry Configuration (opt-in, default disabled)
  telemetryEnabled: false,
  telemetrySampleRate: 0.1, // 10% sample rate when enabled
} as const;

/**
 * Routing strategy specific defaults
 */
export const ROUTING_STRATEGY_DEFAULTS = {
  // FastestPing Strategy
  fastestPing: {
    timeoutMs: 2000,
    maxConcurrency: 5,
  },

  // Round Robin Strategy
  roundRobin: {
    // Uses gateways from provider
  },

  // Random Strategy
  random: {
    // No specific configuration
  },

  // Static Strategy
  static: {
    fallbackGateway: FALLBACK_GATEWAY,
  },
} as const;

/**
 * Verification strategy specific defaults
 */
export const VERIFICATION_STRATEGY_DEFAULTS = {
  // Common verification settings
  maxConcurrency: 2,
  timeoutMs: 60000, // 60 seconds timeout for verification requests

  // Hash Verification
  hash: {
    algorithm: 'sha256',
  },

  // Data Root Verification
  dataRoot: {
    // Uses same base settings
  },

  // Signature Verification
  signature: {
    // Uses same base settings
  },
} as const;

/**
 * Background verification defaults
 */
export const VERIFICATION_DEFAULTS = {
  enableVerificationCache: true,

  // Verification timing
  verificationTimeout: 60000, // 60 seconds (increased for large files)
  verificationRetryDelay: 2000, // 2 seconds
} as const;

/**
 * Cache management defaults
 */
export const CACHE_DEFAULTS = {
  // ArNS Cache Settings
  arnsDefaultTTL: 60 * 60 * 1000, // 1 hour in milliseconds

  // Verification Cache Settings
  verificationCacheEnabled: true,

  // Gateway Cache Settings
  gatewayCacheTTL: 3600, // 1 hour in seconds

  // DNS Cache Settings
  dnsCacheTTL: 3600000, // 1 hour in milliseconds

  // Performance tracking cleanup
  performanceDataCleanupInterval: 30000, // 30 seconds
  performanceDataMaxAge: 60000, // 1 minute
} as const;

/**
 * UI/UX defaults
 */
export const UI_DEFAULTS = {
  // Theme
  theme: 'dark',

  // Verification indicators
  showVerificationIndicators: true,

  // Error display
  showDetailedErrors: true,
  errorDisplayTimeout: 10000, // 10 seconds
  toastDisplayTimeout: 3000, // 3 seconds
} as const;

/**
 * Performance and monitoring defaults
 */
export const PERFORMANCE_DEFAULTS = {
  // Request timing
  requestTimeoutMs: 30000, // 30 seconds

  // Circuit breaker settings
  circuitBreakerEnabled: true,

  // Cleanup intervals
  cleanupIntervals: {
    tabState: 30000, // 30 seconds
    requestTimings: 30000, // 30 seconds
    verificationCache: 60 * 60 * 1000, // 1 hour
  },

  // Data retention
  maxAge: {
    tabState: 60000, // 1 minute
    requestTimings: 60000, // 1 minute
    performanceData: 24 * 60 * 60 * 1000, // 24 hours
  },
} as const;

/**
 * Combined defaults object for easy access
 */
export const ALL_DEFAULTS = {
  ...EXTENSION_DEFAULTS,
  ...WAYFINDER_DEFAULTS,
  ...VERIFICATION_DEFAULTS,
  ...CACHE_DEFAULTS,
  ...UI_DEFAULTS,
  routing: ROUTING_STRATEGY_DEFAULTS,
  verification: VERIFICATION_STRATEGY_DEFAULTS,
  performance: PERFORMANCE_DEFAULTS,
} as const;

/**
 * Helper function to get default values with fallbacks
 */
export function getDefaultValue<T>(
  key: keyof typeof ALL_DEFAULTS,
  fallback?: T,
): T {
  return (ALL_DEFAULTS[key] as T) ?? fallback;
}

/**
 * Helper function to get storage defaults for initialization
 */
export function getStorageDefaults() {
  return {
    ...EXTENSION_DEFAULTS,
    ...WAYFINDER_DEFAULTS,
    ...VERIFICATION_DEFAULTS,
    ...CACHE_DEFAULTS,
    ...UI_DEFAULTS,
  };
}

/**
 * Helper function to get Wayfinder instance defaults
 */
export function getWayfinderInstanceDefaults() {
  return {
    ...WAYFINDER_DEFAULTS,
    routing: ROUTING_STRATEGY_DEFAULTS,
    verification: VERIFICATION_STRATEGY_DEFAULTS,
  };
}
