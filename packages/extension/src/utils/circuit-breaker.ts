/**
 * WayFinder Circuit Breaker Utility
 * Handles gateway failure tracking and automatic recovery
 */

import { logger } from './logger';

interface CircuitBreakerState {
  failureCount: number;
  lastFailureTime: number;
  isOpen: boolean;
  nextRetryTime: number;
}

class CircuitBreaker {
  private states = new Map<string, CircuitBreakerState>();
  private readonly failureThreshold = 3; // Open circuit after 3 failures
  private readonly timeoutMs = 30000; // 30 seconds timeout
  private readonly resetTimeoutMs = 120000; // 2 minutes before retry

  /**
   * Check if a gateway is currently available (circuit closed)
   */
  canExecute(gatewayFQDN: string): boolean {
    const state = this.states.get(gatewayFQDN);

    if (!state) {
      return true; // No failures recorded
    }

    if (!state.isOpen) {
      return true; // Circuit is closed
    }

    // Check if retry timeout has passed
    if (Date.now() >= state.nextRetryTime) {
      logger.info(`Circuit breaker: Attempting recovery for ${gatewayFQDN}`);
      // Half-open state - allow one request to test
      state.isOpen = false;
      this.states.set(gatewayFQDN, state);
      return true;
    }

    logger.debug(`Circuit breaker: ${gatewayFQDN} is still blocked`);
    return false;
  }

  /**
   * Record a successful request to a gateway
   */
  onSuccess(gatewayFQDN: string): void {
    const state = this.states.get(gatewayFQDN);

    if (state) {
      // Reset failure count on success
      state.failureCount = 0;
      state.isOpen = false;
      this.states.set(gatewayFQDN, state);

      logger.debug(
        `Circuit breaker: ${gatewayFQDN} success recorded, failures reset`,
      );
    }
  }

  /**
   * Record a failed request to a gateway
   */
  onFailure(gatewayFQDN: string): void {
    const now = Date.now();
    let state = this.states.get(gatewayFQDN);

    if (!state) {
      state = {
        failureCount: 0,
        lastFailureTime: now,
        isOpen: false,
        nextRetryTime: 0,
      };
    }

    state.failureCount++;
    state.lastFailureTime = now;

    // Open circuit if failure threshold is reached
    if (state.failureCount >= this.failureThreshold) {
      state.isOpen = true;
      state.nextRetryTime = now + this.resetTimeoutMs;

      logger.warn(
        `Circuit breaker: ${gatewayFQDN} circuit opened after ${state.failureCount} failures`,
      );
    } else {
      logger.debug(
        `Circuit breaker: ${gatewayFQDN} failure ${state.failureCount}/${this.failureThreshold}`,
      );
    }

    this.states.set(gatewayFQDN, state);
  }

  /**
   * Get the current state of a gateway
   */
  getState(gatewayFQDN: string): CircuitBreakerState | null {
    return this.states.get(gatewayFQDN) || null;
  }

  /**
   * Get all blocked gateways
   */
  getBlockedGateways(): string[] {
    const blocked: string[] = [];

    for (const [gatewayFQDN, state] of this.states) {
      if (state.isOpen && Date.now() < state.nextRetryTime) {
        blocked.push(gatewayFQDN);
      }
    }

    return blocked;
  }

  /**
   * Manually reset a gateway's circuit breaker
   */
  reset(gatewayFQDN: string): void {
    this.states.delete(gatewayFQDN);
    logger.info(`Circuit breaker: Manually reset for ${gatewayFQDN}`);
  }

  /**
   * Clean up old states (for memory management)
   */
  cleanup(): void {
    const now = Date.now();
    const maxAge = 3600000; // 1 hour

    for (const [gatewayFQDN, state] of this.states) {
      if (now - state.lastFailureTime > maxAge && !state.isOpen) {
        this.states.delete(gatewayFQDN);
        logger.debug(
          `Circuit breaker: Cleaned up old state for ${gatewayFQDN}`,
        );
      }
    }
  }
}

export const circuitBreaker = new CircuitBreaker();

// Clean up old states every 30 minutes
setInterval(() => {
  circuitBreaker.cleanup();
}, 1800000);
