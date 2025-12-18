/**
 * WayFinder Extension - Trusted Gateway Provider
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc.
 *
 * Licensed under the Apache License, Version 2.0
 *
 * Provides trusted gateways for verification, sorted by total stake.
 * Uses the extension's cached gateway registry from chrome.storage.
 */

export interface GatewayWithStake {
  url: string;
  totalStake: number;
}

const CACHE_KEY = 'wayfinder-trusted-gateways';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const TOP_POOL_SIZE = 10;

interface TrustedGatewayCache {
  gateways: GatewayWithStake[];
  fetchedAt: number;
}

/**
 * Get trusted gateways for verification, sorted by total stake.
 * Uses the extension's synced gateway registry.
 *
 * @param count Number of gateways to return (1-10, default 3)
 * @returns Array of gateway URLs (strings)
 */
export async function getTrustedGateways(count: number = 3): Promise<string[]> {
  const validCount = Math.max(1, Math.min(10, count));

  // Check cache first
  const cached = await getCachedGateways();
  if (cached) {
    const shuffled = shuffleArray([...cached]);
    return shuffled.slice(0, validCount).map((g) => g.url);
  }

  // Fetch from extension's gateway registry
  try {
    const { localGatewayAddressRegistry = {} } = await chrome.storage.local.get(
      ['localGatewayAddressRegistry'],
    );

    const registryEntries = Object.values(localGatewayAddressRegistry) as any[];

    if (registryEntries.length === 0) {
      console.warn('[TrustedGateways] No gateways in registry, using fallback');
      return ['https://arweave.net'];
    }

    // Filter active gateways and calculate total stake
    const gatewaysWithTotalStake: GatewayWithStake[] = registryEntries
      .filter(
        (gateway: any) => gateway.status === 'joined' && gateway.settings?.fqdn,
      )
      .map((gateway: any) => {
        const { protocol = 'https', fqdn, port } = gateway.settings;
        const url =
          port && port !== 443
            ? `${protocol}://${fqdn}:${port}`
            : `${protocol}://${fqdn}`;
        return {
          url,
          totalStake:
            (gateway.operatorStake || 0) + (gateway.totalDelegatedStake || 0),
        };
      });

    // Sort by total stake descending
    gatewaysWithTotalStake.sort((a, b) => b.totalStake - a.totalStake);

    // Take top N by total stake for the pool
    const topPool = gatewaysWithTotalStake.slice(0, TOP_POOL_SIZE);

    if (topPool.length === 0) {
      console.warn(
        '[TrustedGateways] No active staked gateways, using fallback',
      );
      return ['https://arweave.net'];
    }

    // Cache the full pool
    await cacheGateways(topPool);

    // Shuffle and return requested count
    const shuffled = shuffleArray([...topPool]);
    return shuffled.slice(0, validCount).map((g) => g.url);
  } catch (error) {
    console.error('[TrustedGateways] Failed to fetch gateways:', error);
    return ['https://arweave.net'];
  }
}

/**
 * Get the full pool of top-staked gateways with stake info.
 * For display in UI.
 */
export async function getTopStakedGateways(): Promise<GatewayWithStake[]> {
  const cached = await getCachedGateways();
  if (cached) {
    return cached;
  }

  // Fetch fresh - this will also populate the cache
  await getTrustedGateways(TOP_POOL_SIZE);

  const freshCached = await getCachedGateways();
  return freshCached || [{ url: 'https://arweave.net', totalStake: 0 }];
}

/**
 * Get routing gateways for content fetching.
 * Returns a broader pool from the gateway registry.
 */
export async function getRoutingGateways(): Promise<string[]> {
  try {
    const { localGatewayAddressRegistry = {} } = await chrome.storage.local.get(
      ['localGatewayAddressRegistry'],
    );

    const registryEntries = Object.values(localGatewayAddressRegistry) as any[];

    if (registryEntries.length === 0) {
      console.warn('[RoutingGateways] No gateways in registry');
      return [];
    }

    // Filter active gateways
    const gateways = registryEntries
      .filter(
        (gateway: any) => gateway.status === 'joined' && gateway.settings?.fqdn,
      )
      .map((gateway: any) => {
        const { protocol = 'https', fqdn, port } = gateway.settings;
        return port && port !== 443
          ? `${protocol}://${fqdn}:${port}`
          : `${protocol}://${fqdn}`;
      });

    // Shuffle for load distribution
    const shuffled = shuffleArray([...gateways]);

    // Return a reasonable subset
    return shuffled.slice(0, Math.min(20, shuffled.length));
  } catch (error) {
    console.error('[RoutingGateways] Failed to fetch gateways:', error);
    return [];
  }
}

function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

async function getCachedGateways(): Promise<GatewayWithStake[] | null> {
  try {
    const result = await chrome.storage.local.get([CACHE_KEY]);
    const cached = result[CACHE_KEY];
    if (!cached) return null;

    const parsed: TrustedGatewayCache = cached;
    const age = Date.now() - parsed.fetchedAt;

    if (age > CACHE_TTL) {
      await chrome.storage.local.remove([CACHE_KEY]);
      return null;
    }

    return parsed.gateways;
  } catch {
    return null;
  }
}

async function cacheGateways(gateways: GatewayWithStake[]): Promise<void> {
  try {
    const cache: TrustedGatewayCache = {
      gateways,
      fetchedAt: Date.now(),
    };
    await chrome.storage.local.set({ [CACHE_KEY]: cache });
  } catch {
    // Silent fail - caching is optional
  }
}

export async function clearTrustedGatewayCache(): Promise<void> {
  await chrome.storage.local.remove([CACHE_KEY]);
}
