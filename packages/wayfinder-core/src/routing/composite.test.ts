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
import { CompositeRoutingStrategy } from './composite.js';

describe('CompositeRoutingStrategy', () => {
  let mockLogger: Logger;
  let logCalls: { method: string; args: any[] }[];

  beforeEach(() => {
    logCalls = [];
    mockLogger = {
      debug: (...args) => logCalls.push({ method: 'debug', args }),
      info: (...args) => logCalls.push({ method: 'info', args }),
      warn: (...args) => logCalls.push({ method: 'warn', args }),
      error: (...args) => logCalls.push({ method: 'error', args }),
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
          return (value as URL) || new URL('https://default.com');
        } else {
          throw value || new Error(`${name} failed`);
        }
      },
    };
  };

  it('should throw an error if no strategies are provided', () => {
    assert.throws(
      () => new CompositeRoutingStrategy({ strategies: [] }),
      /At least one routing strategy must be provided/,
    );
  });

  it('should return gateway from first successful strategy', async () => {
    const gateway1 = new URL('https://gateway1.com');
    const gateways = [gateway1, new URL('https://gateway2.com')];

    const mockStrategy1 = createMockStrategy('strategy1', 'resolve', gateway1);
    const mockStrategy2 = createMockStrategy('strategy2', 'resolve');
    const mockStrategy3 = createMockStrategy('strategy3', 'resolve');

    const composite = new CompositeRoutingStrategy({
      strategies: [mockStrategy1, mockStrategy2, mockStrategy3],
      logger: mockLogger,
    });

    const result = await composite.selectGateway({ gateways });

    assert.equal(result, gateway1);
  });

  it('should try next strategy if previous one fails', async () => {
    const gateway2 = new URL('https://gateway2.com');
    const gateways = [new URL('https://gateway1.com'), gateway2];

    const mockStrategy1 = createMockStrategy('strategy1', 'reject');
    const mockStrategy2 = createMockStrategy('strategy2', 'resolve', gateway2);
    const mockStrategy3 = createMockStrategy('strategy3', 'resolve');

    const composite = new CompositeRoutingStrategy({
      strategies: [mockStrategy1, mockStrategy2, mockStrategy3],
      logger: mockLogger,
    });

    const result = await composite.selectGateway({ gateways });

    assert.equal(result, gateway2);
  });

  it('should throw error if all strategies fail', async () => {
    const gateways = [new URL('https://gateway1.com')];

    const mockStrategy1 = createMockStrategy('strategy1', 'reject');
    const mockStrategy2 = createMockStrategy('strategy2', 'reject');
    const mockStrategy3 = createMockStrategy('strategy3', 'reject');

    const composite = new CompositeRoutingStrategy({
      strategies: [mockStrategy1, mockStrategy2, mockStrategy3],
      logger: mockLogger,
    });

    await assert.rejects(
      async () => await composite.selectGateway({ gateways }),
      /All routing strategies failed to select a gateway/,
    );
  });

  it('should pass all parameters to strategies', async () => {
    const gateway1 = new URL('https://gateway1.com');
    const params = {
      gateways: [gateway1],
      path: '/data/123',
      subdomain: 'sub',
    };

    let capturedParams: any;
    const mockStrategy1: RoutingStrategy = {
      name: 'strategy1',
      selectGateway: async (p) => {
        capturedParams = p;
        return gateway1;
      },
    };

    const composite = new CompositeRoutingStrategy({
      strategies: [mockStrategy1],
      logger: mockLogger,
    });

    await composite.selectGateway(params);

    assert.deepEqual(capturedParams, params);
  });

  it('should add strategy using addStrategy method', async () => {
    const gateway1 = new URL('https://gateway1.com');
    const gateways = [gateway1];

    const mockStrategy1 = createMockStrategy('strategy1', 'reject');
    const mockStrategy2 = createMockStrategy('strategy2', 'resolve', gateway1);

    const composite = new CompositeRoutingStrategy({
      strategies: [mockStrategy1],
      logger: mockLogger,
    });

    composite.addStrategy(mockStrategy2);

    const result = await composite.selectGateway({ gateways });

    assert.equal(result, gateway1);
  });

  it('should return copy of strategies with getStrategies', () => {
    const mockStrategy1 = createMockStrategy('strategy1', 'resolve');
    const mockStrategy2 = createMockStrategy('strategy2', 'resolve');

    const composite = new CompositeRoutingStrategy({
      strategies: [mockStrategy1, mockStrategy2],
      logger: mockLogger,
    });

    const strategies = composite.getStrategies();

    assert.deepEqual(strategies, [mockStrategy1, mockStrategy2]);
    assert.notStrictEqual(strategies, composite['strategies']);
  });

  it('should work with a single strategy', async () => {
    const gateway1 = new URL('https://gateway1.com');
    const gateways = [gateway1];

    const mockStrategy1 = createMockStrategy('strategy1', 'resolve', gateway1);

    const composite = new CompositeRoutingStrategy({
      strategies: [mockStrategy1],
      logger: mockLogger,
    });

    const result = await composite.selectGateway({ gateways });

    assert.equal(result, gateway1);
  });

  it('should log debug messages during execution', async () => {
    const gateway1 = new URL('https://gateway1.com');
    const gateways = [gateway1];

    const mockStrategy1 = createMockStrategy('strategy1', 'resolve', gateway1);

    const composite = new CompositeRoutingStrategy({
      strategies: [mockStrategy1],
      logger: mockLogger,
    });

    await composite.selectGateway({ gateways });

    assert.equal(logCalls.filter((call) => call.method === 'debug').length, 3);
    assert.ok(
      logCalls.some(
        (call) =>
          call.method === 'debug' &&
          call.args[0] ===
            'CompositeRoutingStrategy: starting gateway selection',
      ),
    );
    assert.ok(
      logCalls.some(
        (call) =>
          call.method === 'debug' &&
          call.args[0] === 'CompositeRoutingStrategy: trying strategy',
      ),
    );
    assert.ok(
      logCalls.some(
        (call) =>
          call.method === 'debug' &&
          call.args[0] === 'CompositeRoutingStrategy: strategy succeeded',
      ),
    );
  });
});
