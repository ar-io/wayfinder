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
import assert from 'node:assert';
import { beforeEach, describe, it } from 'node:test';
import type { GatewaysProvider, Logger } from '../types.js';
import { CompositeGatewaysProvider } from './composite.js';

describe('CompositeGatewaysProvider', () => {
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

  const createMockProvider = (
    behavior: 'resolve' | 'reject' | 'empty',
    gateways?: URL[],
  ): GatewaysProvider => {
    return {
      getGateways: async () => {
        if (behavior === 'resolve') {
          return (
            gateways || [
              new URL('https://default1.com'),
              new URL('https://default2.com'),
            ]
          );
        } else if (behavior === 'empty') {
          return [];
        } else {
          throw new Error('Provider failed');
        }
      },
    };
  };

  it('should throw an error if no providers are provided', () => {
    assert.throws(
      () => new CompositeGatewaysProvider({ providers: [] }),
      /At least one gateways provider must be provided/,
    );
  });

  it('should throw an error when constructed with default empty providers', () => {
    assert.throws(
      () => new CompositeGatewaysProvider({}),
      /At least one gateways provider must be provided/,
    );
  });

  it('should return gateways from first successful provider', async () => {
    const gateways1 = [
      new URL('https://gateway1.com'),
      new URL('https://gateway2.com'),
    ];
    const gateways2 = [new URL('https://gateway3.com')];

    const mockProvider1 = createMockProvider('resolve', gateways1);
    const mockProvider2 = createMockProvider('resolve', gateways2);

    const composite = new CompositeGatewaysProvider({
      providers: [mockProvider1, mockProvider2],
      logger: mockLogger,
    });

    const result = await composite.getGateways();

    assert.deepEqual(result, gateways1);
  });

  it('should try next provider if previous one fails', async () => {
    const gateways2 = [
      new URL('https://gateway2.com'),
      new URL('https://gateway3.com'),
    ];

    const mockProvider1 = createMockProvider('reject');
    const mockProvider2 = createMockProvider('resolve', gateways2);

    const composite = new CompositeGatewaysProvider({
      providers: [mockProvider1, mockProvider2],
      logger: mockLogger,
    });

    const result = await composite.getGateways();

    assert.deepEqual(result, gateways2);
  });

  it('should try next provider if previous one returns empty array', async () => {
    const gateways2 = [new URL('https://gateway2.com')];

    const mockProvider1 = createMockProvider('empty');
    const mockProvider2 = createMockProvider('resolve', gateways2);

    const composite = new CompositeGatewaysProvider({
      providers: [mockProvider1, mockProvider2],
      logger: mockLogger,
    });

    const result = await composite.getGateways();

    assert.deepEqual(result, gateways2);
  });

  it('should throw error if all providers fail', async () => {
    const mockProvider1 = createMockProvider('reject');
    const mockProvider2 = createMockProvider('reject');
    const mockProvider3 = createMockProvider('reject');

    const composite = new CompositeGatewaysProvider({
      providers: [mockProvider1, mockProvider2, mockProvider3],
      logger: mockLogger,
    });

    await assert.rejects(
      async () => await composite.getGateways(),
      /All gateways providers failed to return gateways/,
    );
  });

  it('should throw error if all providers return empty arrays', async () => {
    const mockProvider1 = createMockProvider('empty');
    const mockProvider2 = createMockProvider('empty');

    const composite = new CompositeGatewaysProvider({
      providers: [mockProvider1, mockProvider2],
      logger: mockLogger,
    });

    await assert.rejects(
      async () => await composite.getGateways(),
      /All gateways providers failed to return gateways/,
    );
  });

  it('should add provider using addProvider method', async () => {
    const gateways = [new URL('https://gateway1.com')];

    const mockProvider1 = createMockProvider('reject');
    const mockProvider2 = createMockProvider('resolve', gateways);

    const composite = new CompositeGatewaysProvider({
      providers: [mockProvider1],
      logger: mockLogger,
    });

    composite.addProvider(mockProvider2);

    const result = await composite.getGateways();

    assert.deepEqual(result, gateways);
  });

  it('should return copy of providers with getProviders', () => {
    const mockProvider1 = createMockProvider('resolve');
    const mockProvider2 = createMockProvider('resolve');

    const composite = new CompositeGatewaysProvider({
      providers: [mockProvider1, mockProvider2],
      logger: mockLogger,
    });

    const providers = composite.getProviders();

    assert.deepEqual(providers, [mockProvider1, mockProvider2]);
    assert.notStrictEqual(providers, composite['providers']);
  });

  it('should work with a single provider', async () => {
    const gateways = [new URL('https://gateway1.com')];

    const mockProvider1 = createMockProvider('resolve', gateways);

    const composite = new CompositeGatewaysProvider({
      providers: [mockProvider1],
      logger: mockLogger,
    });

    const result = await composite.getGateways();

    assert.deepEqual(result, gateways);
  });

  it('should skip failing providers and empty providers to find working one', async () => {
    const gateways = [new URL('https://gateway3.com')];

    const mockProvider1 = createMockProvider('reject');
    const mockProvider2 = createMockProvider('empty');
    const mockProvider3 = createMockProvider('resolve', gateways);

    const composite = new CompositeGatewaysProvider({
      providers: [mockProvider1, mockProvider2, mockProvider3],
      logger: mockLogger,
    });

    const result = await composite.getGateways();

    assert.deepEqual(result, gateways);
  });

  it('should use default logger when not provided', async () => {
    const gateways = [new URL('https://gateway1.com')];
    const mockProvider = createMockProvider('resolve', gateways);

    const composite = new CompositeGatewaysProvider({
      providers: [mockProvider],
    });

    const result = await composite.getGateways();

    assert.deepEqual(result, gateways);
  });
});
