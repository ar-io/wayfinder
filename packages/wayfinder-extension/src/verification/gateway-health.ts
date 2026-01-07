/**
 * WayFinder Extension - Gateway Health Tracking
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc.
 *
 * Licensed under the Apache License, Version 2.0
 *
 * Service Worker Gateway Health Cache.
 * Tracks unhealthy gateways to avoid repeated failures.
 */

import type { GatewayHealthEntry, HealthCheckResult } from './types';

// Default blacklist duration: 5 minutes
const DEFAULT_BLACKLIST_DURATION_MS = 5 * 60 * 1000;

// Health check timeout: 5 seconds
const HEALTH_CHECK_TIMEOUT_MS = 5000;

/**
 * Extract hostname from a gateway URL for consistent tracking.
 */
function extractHostname(gateway: string): string {
  try {
    const url = new URL(gateway);
    return url.hostname;
  } catch {
    return gateway;
  }
}

class SwGatewayHealthCache {
  private unhealthyGateways: Map<string, GatewayHealthEntry> = new Map();

  /**
   * Mark a gateway as unhealthy for the specified duration.
   */
  markUnhealthy(
    gateway: string,
    durationMs: number = DEFAULT_BLACKLIST_DURATION_MS,
    error?: string,
  ): void {
    const hostname = extractHostname(gateway);
    const now = Date.now();

    this.unhealthyGateways.set(hostname, {
      failedAt: now,
      expiresAt: now + durationMs,
      error,
    });

    console.log(
      `[SW:GatewayHealth] Marked ${hostname} as unhealthy for ${durationMs / 1000}s${error ? `: ${error}` : ''}`,
    );
  }

  /**
   * Check if a gateway is currently healthy.
   */
  isHealthy(gateway: string): boolean {
    const hostname = extractHostname(gateway);
    const entry = this.unhealthyGateways.get(hostname);

    if (!entry) {
      return true;
    }

    if (Date.now() > entry.expiresAt) {
      this.unhealthyGateways.delete(hostname);
      return true;
    }

    return false;
  }

  /**
   * Filter a list of gateways to only include healthy ones.
   */
  filterHealthy(gateways: string[]): string[] {
    return gateways.filter((gateway) => this.isHealthy(gateway));
  }

  /**
   * Clear all health data.
   */
  clear(): void {
    const count = this.unhealthyGateways.size;
    this.unhealthyGateways.clear();
    if (count > 0) {
      console.log(
        `[SW:GatewayHealth] Cleared ${count} unhealthy gateway entries`,
      );
    }
  }

  /**
   * Get count of unhealthy gateways.
   */
  getUnhealthyCount(): number {
    // Clean up expired entries first
    const now = Date.now();
    for (const [hostname, entry] of this.unhealthyGateways) {
      if (now > entry.expiresAt) {
        this.unhealthyGateways.delete(hostname);
      }
    }
    return this.unhealthyGateways.size;
  }
}

// Export singleton instance for service worker
export const swGatewayHealth = new SwGatewayHealthCache();

/**
 * Check if a gateway is responsive by making a HEAD request.
 */
export async function checkSwGatewayHealth(
  url: string,
  timeoutMs: number = HEALTH_CHECK_TIMEOUT_MS,
  markUnhealthyOnFail: boolean = true,
): Promise<HealthCheckResult> {
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'manual',
    });

    clearTimeout(timeoutId);

    const latencyMs = Date.now() - startTime;

    // 5xx indicates gateway issues
    if (response.status >= 500) {
      const error = `Server error: ${response.status}`;
      if (markUnhealthyOnFail) {
        swGatewayHealth.markUnhealthy(url, undefined, error);
      }
      return { healthy: false, error, latencyMs };
    }

    return { healthy: true, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    let error: string;

    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        error = `Timeout after ${timeoutMs}ms`;
      } else if (err.message.includes('Failed to fetch')) {
        error = 'Gateway unreachable';
      } else {
        error = err.message;
      }
    } else {
      error = 'Unknown error';
    }

    if (markUnhealthyOnFail) {
      swGatewayHealth.markUnhealthy(url, undefined, error);
    }

    return { healthy: false, error, latencyMs };
  }
}

/**
 * Select a healthy gateway from a list, with health check validation.
 * Returns the first gateway that passes the health check.
 */
export async function selectHealthyGateway(
  gateways: string[],
): Promise<string | null> {
  // First filter out known unhealthy gateways
  let candidates = swGatewayHealth.filterHealthy(gateways);

  // If all are marked unhealthy, clear cache and use all
  if (candidates.length === 0) {
    console.log(
      '[SW:GatewayHealth] All gateways marked unhealthy, clearing cache',
    );
    swGatewayHealth.clear();
    candidates = gateways;
  }

  // Try each candidate until one passes health check
  for (const gateway of candidates) {
    const result = await checkSwGatewayHealth(gateway);
    if (result.healthy) {
      console.log(
        `[SW:GatewayHealth] Selected healthy gateway: ${gateway} (${result.latencyMs}ms)`,
      );
      return gateway;
    }
  }

  // All failed - return first gateway as last resort
  console.log(
    '[SW:GatewayHealth] All health checks failed, using first gateway as fallback',
  );
  return gateways[0] || null;
}
