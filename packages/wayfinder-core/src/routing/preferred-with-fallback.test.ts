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
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { Logger, RoutingStrategy } from '../types.js';
import { PreferredWithFallbackRoutingStrategy } from './preferred-with-fallback.js';

describe('PreferredWithFallbackRoutingStrategy', () => {
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      debug: () => {
        /* no-op for testing */
      },
      info: () => {
        /* no-op for testing */
      },
      warn: () => {
        /* no-op for testing */
      },
      error: () => {
        /* no-op for testing */
      },
    };
  });

  const createMockStrategy = (
    name: string,
    behavior: 'resolve' | 'reject',
    value?: URL | Error,
  ): RoutingStrategy => {
    return {
      name,
      selectGateway: async () => {
        if (behavior === 'resolve') {
          return (value as URL) || new URL('https://fallback.com');
        } else {
          throw value || new Error(`${name} failed`);
        }
      },
    };
  };

  describe('constructor', () => {
    it('should initialize with preferred gateway and default fallback strategy', () => {
      const preferredGateway = 'https://preferred.com';
      const strategy = new PreferredWithFallbackRoutingStrategy({
        preferredGateway,
      });

      assert.equal(strategy.name, 'preferred-with-fallback');
      assert.equal(
        strategy.preferredGateway.toString(),
        preferredGateway + '/',
      );
      assert.equal(strategy.fallbackStrategy.name, 'fastest-ping');
    });

    it('should initialize with custom fallback strategy', () => {
      const preferredGateway = 'https://preferred.com';
      const customFallback = createMockStrategy('custom', 'resolve');

      const strategy = new PreferredWithFallbackRoutingStrategy({
        preferredGateway,
        fallbackStrategy: customFallback,
      });

      assert.equal(strategy.fallbackStrategy, customFallback);
    });

    it('should initialize with custom logger', () => {
      const preferredGateway = 'https://preferred.com';

      const strategy = new PreferredWithFallbackRoutingStrategy({
        preferredGateway,
        logger: mockLogger,
      });

      assert.equal(strategy.name, 'preferred-with-fallback');
    });

    it('should throw error for invalid preferred gateway URL', () => {
      assert.throws(
        () =>
          new PreferredWithFallbackRoutingStrategy({
            preferredGateway: 'not-a-valid-url',
          }),
        /Invalid URL/,
        'Should throw an error when an invalid URL is provided',
      );
    });
  });

  describe('selectGateway', () => {
    it('should delegate to composite strategy', async () => {
      const preferredGateway = 'https://preferred.com';
      const mockFallback = createMockStrategy(
        'fallback',
        'resolve',
        new URL('https://fallback.com'),
      );

      const strategy = new PreferredWithFallbackRoutingStrategy({
        preferredGateway,
        fallbackStrategy: mockFallback,
        logger: mockLogger,
      });

      const gateways = [
        new URL('https://gateway1.com'),
        new URL('https://gateway2.com'),
      ];
      const result = await strategy.selectGateway({
        gateways,
        path: '/data/123',
        subdomain: 'test',
      });

      assert.ok(result instanceof URL);
    });

    it('should work with no parameters', async () => {
      const preferredGateway = 'https://preferred.com';
      const mockFallback = createMockStrategy(
        'fallback',
        'resolve',
        new URL('https://fallback.com'),
      );

      const strategy = new PreferredWithFallbackRoutingStrategy({
        preferredGateway,
        fallbackStrategy: mockFallback,
        logger: mockLogger,
      });

      const result = await strategy.selectGateway();

      assert.ok(result instanceof URL);
    });

    it('should work with partial parameters', async () => {
      const preferredGateway = 'https://preferred.com';
      const mockFallback = createMockStrategy(
        'fallback',
        'resolve',
        new URL('https://fallback.com'),
      );

      const strategy = new PreferredWithFallbackRoutingStrategy({
        preferredGateway,
        fallbackStrategy: mockFallback,
        logger: mockLogger,
      });

      const result = await strategy.selectGateway({
        path: '/data/123',
      });

      assert.ok(result instanceof URL);
    });
  });

  describe('integration tests', () => {
    it('should try preferred gateway first, then fallback on failure', async () => {
      const preferredGateway = 'https://preferred.com';
      const fallbackUrl = new URL('https://fallback.com');
      const mockFallback = createMockStrategy(
        'fallback',
        'resolve',
        fallbackUrl,
      );

      const strategy = new PreferredWithFallbackRoutingStrategy({
        preferredGateway,
        fallbackStrategy: mockFallback,
        logger: mockLogger,
      });

      const result = await strategy.selectGateway();

      assert.ok(result instanceof URL);
    });

    it('should handle case where both preferred and fallback fail', async () => {
      const preferredGateway = 'https://preferred.com';
      const mockFallback = createMockStrategy(
        'fallback',
        'reject',
        new Error('Fallback failed'),
      );

      const strategy = new PreferredWithFallbackRoutingStrategy({
        preferredGateway,
        fallbackStrategy: mockFallback,
        logger: mockLogger,
      });

      await assert.rejects(
        async () => await strategy.selectGateway(),
        /All routing strategies failed to select a gateway/,
      );
    });

    it('should maintain strategy order: preferred ping strategy then fallback', () => {
      const preferredGateway = 'https://preferred.com';
      const mockFallback = createMockStrategy('custom-fallback', 'resolve');

      const strategy = new PreferredWithFallbackRoutingStrategy({
        preferredGateway,
        fallbackStrategy: mockFallback,
        logger: mockLogger,
      });

      const compositeStrategy = strategy['compositeStrategy'];
      const strategies = compositeStrategy.getStrategies();

      assert.equal(strategies.length, 2);
      assert.equal(strategies[0].name, 'ping');
      assert.equal(strategies[1].name, 'custom-fallback');
    });

    it('should configure ping strategy with correct parameters', () => {
      const preferredGateway = 'https://preferred.com';

      const strategy = new PreferredWithFallbackRoutingStrategy({
        preferredGateway,
        logger: mockLogger,
      });

      const compositeStrategy = strategy['compositeStrategy'];
      const strategies = compositeStrategy.getStrategies();
      const pingStrategy = strategies[0] as any;

      assert.equal(pingStrategy.retries, 1);
      assert.equal(pingStrategy.timeoutMs, 1000);
      assert.equal(pingStrategy.routingStrategy.name, 'static');
    });
  });
});
