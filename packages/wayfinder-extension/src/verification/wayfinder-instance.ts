/**
 * WayFinder Extension - Wayfinder Client Instance
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc.
 *
 * Licensed under the Apache License, Version 2.0
 *
 * Creates and manages the Wayfinder client for routing and verification.
 * Uses HashVerificationStrategy for content verification.
 */

import {
  HashVerificationStrategy,
  StaticRoutingStrategy,
  createRoutingStrategy,
  createWayfinderClient,
} from '@ar.io/wayfinder-core';
import type { VerificationStrategy, Wayfinder } from '@ar.io/wayfinder-core';
import { logger } from './logger';
import type { SwWayfinderConfig } from './types';

const TAG = 'Wayfinder';

let wayfinderInstance: Wayfinder | null = null;
let currentConfig: SwWayfinderConfig | null = null;
let verificationStrategy: VerificationStrategy | null = null;

// Selected gateway for current manifest verification
// When set, all resource fetches use this gateway instead of random selection
let selectedGateway: URL | null = null;

// Promise that resolves when Wayfinder is initialized
// Used by fetch handler to wait for initialization instead of returning 503
let initializationResolve: (() => void) | null = null;
let initializationPromise: Promise<void> | null = null;

/**
 * Wait for Wayfinder to be initialized.
 * Returns immediately if already initialized, otherwise waits up to maxWaitMs.
 *
 * @param maxWaitMs Maximum time to wait in milliseconds (default 10 seconds)
 * @returns true if initialized, false if timed out
 */
export async function waitForInitialization(
  maxWaitMs = 10000,
): Promise<boolean> {
  // Already initialized
  if (wayfinderInstance !== null) {
    return true;
  }

  // Create the promise if it doesn't exist
  if (!initializationPromise) {
    initializationPromise = new Promise<void>((resolve) => {
      initializationResolve = resolve;
    });
  }

  // Race between initialization and timeout
  const timeoutPromise = new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(false), maxWaitMs);
  });

  const initPromise = initializationPromise.then(() => true);

  const result = await Promise.race([initPromise, timeoutPromise]);

  return result;
}

/**
 * Set a specific gateway for all subsequent resource fetches.
 * Used to ensure all resources in a manifest come from the same gateway.
 */
export function setSelectedGateway(gateway: string | null): void {
  selectedGateway = gateway ? new URL(gateway) : null;
  logger.debug(TAG, `Gateway: ${selectedGateway?.hostname || 'random'}`);
}

/**
 * Get the currently selected gateway.
 */
export function getSelectedGateway(): string | null {
  return selectedGateway?.toString() || null;
}

// Quiet logger for Wayfinder core - suppresses debug/info logs to reduce noise
const quietWayfinderLogger = {
  debug: () => {
    /* noop - suppress debug logs */
  },
  info: () => {
    /* noop - suppress info logs */
  },
  warn: console.warn,
  error: console.error,
};

/**
 * Initialize the Wayfinder client with the given configuration.
 */
export function initializeWayfinder(config: SwWayfinderConfig): void {
  logger.info(
    TAG,
    `Init: hash verification, ${config.trustedGateways.length} verification gateways`,
  );

  currentConfig = config;

  // ROUTING gateways: Broader pool for load distribution
  // Verification gateways are handled separately by manifest-verifier.ts
  const routingGateways =
    config.routingGateways && config.routingGateways.length > 0
      ? config.routingGateways.map((url) => new URL(url))
      : config.trustedGateways.map((url) => new URL(url));
  logger.debug(TAG, `Routing gateways: ${routingGateways.length}`);

  // Create gateways provider for routing
  const gatewaysProvider = {
    async getGateways() {
      // If a specific gateway is selected (for manifest consistency), use only that
      if (selectedGateway) {
        return [selectedGateway];
      }

      // Otherwise shuffle for load distribution
      const shuffled = [...routingGateways];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    },
  };

  // Create routing strategy
  // Handle 'preferred' or 'static' strategy using StaticRoutingStrategy
  let routingStrategy;
  const isStaticStrategy =
    (config.routingStrategy === 'preferred' ||
      config.routingStrategy === 'static') &&
    config.preferredGateway;
  if (isStaticStrategy) {
    const preferredGateway =
      typeof config.preferredGateway === 'string'
        ? config.preferredGateway.trim()
        : 'https://arweave.net';
    logger.debug(TAG, `Using preferred gateway: ${preferredGateway}`);
    routingStrategy = new StaticRoutingStrategy({
      gateway: preferredGateway || 'https://arweave.net',
      logger: quietWayfinderLogger,
    });
  } else {
    // Map extension strategy names to wayfinder-core strategy names
    // Extension uses: 'fastestPing', 'random', 'static'
    // Wayfinder-core uses: 'fastest', 'random', 'balanced'
    let strategyName: 'random' | 'fastest' | 'balanced';
    switch (config.routingStrategy) {
      case 'fastestPing':
        strategyName = 'fastest';
        break;
      case 'roundRobin':
        strategyName = 'balanced';
        break;
      case 'random':
      default:
        strategyName = 'random';
        break;
    }
    routingStrategy = createRoutingStrategy({
      strategy: strategyName,
      gatewaysProvider,
      logger: quietWayfinderLogger,
    });
  }

  // Create HashVerificationStrategy for content verification
  const trustedGatewayUrls = config.trustedGateways.map((url) => new URL(url));
  verificationStrategy = new HashVerificationStrategy({
    trustedGateways: trustedGatewayUrls,
    maxConcurrency: 3,
    logger: quietWayfinderLogger,
  });
  logger.debug(
    TAG,
    `Verification strategy: HashVerificationStrategy with ${trustedGatewayUrls.length} trusted gateways`,
  );

  // Create Wayfinder client
  // Verification is handled by manifest-verifier.ts using getVerificationStrategy()
  // We disable it here to avoid double-verification when using wayfinder.request()
  wayfinderInstance = createWayfinderClient({
    logger: quietWayfinderLogger,
    routingSettings: {
      strategy: routingStrategy,
    },
    verificationSettings: { enabled: false },
    telemetrySettings: {
      enabled: false,
    },
  });

  // Resolve any pending initialization waiters
  if (initializationResolve) {
    initializationResolve();
    initializationResolve = null;
    initializationPromise = null;
  }

  logger.info(
    TAG,
    `Ready: verification=${config.enabled ? 'hash' : 'disabled'}, strict=${config.strict}`,
  );
}

/**
 * Get the Wayfinder client instance.
 * Throws if not initialized.
 */
export function getWayfinder(): Wayfinder {
  if (!wayfinderInstance) {
    throw new Error('Wayfinder not initialized');
  }
  return wayfinderInstance;
}

/**
 * Check if Wayfinder is ready.
 */
export function isWayfinderReady(): boolean {
  return wayfinderInstance !== null;
}

/**
 * Get the current configuration.
 */
export function getConfig(): SwWayfinderConfig | null {
  return currentConfig;
}

/**
 * Get the verification strategy instance (HashVerificationStrategy).
 * Throws if not initialized.
 */
export function getVerificationStrategy(): VerificationStrategy {
  if (!verificationStrategy) {
    throw new Error('Verification strategy not initialized');
  }
  return verificationStrategy;
}
