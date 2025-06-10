/**
 * Copyright (C) 2022-2024 Permanent Data Solutions, Inc.
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
import { describe, it } from 'node:test';

import { StaticRoutingStrategy } from './static.js';

// Create a test logger that captures logs
class TestLogger {
  logs: Array<{ level: string; message: string; args: any[] }> = [];

  debug(message: string, ...args: any[]) {
    this.logs.push({ level: 'debug', message, args });
  }

  info(message: string, ...args: any[]) {
    this.logs.push({ level: 'info', message, args });
  }

  warn(message: string, ...args: any[]) {
    this.logs.push({ level: 'warn', message, args });
  }

  error(message: string, ...args: any[]) {
    this.logs.push({ level: 'error', message, args });
  }

  clear() {
    this.logs = [];
  }
}

describe('StaticRoutingStrategy', () => {
  it('returns the configured gateway regardless of the gateways parameter', async () => {
    const staticGateway = 'https://static-example.com/';
    const strategy = new StaticRoutingStrategy({
      gateway: staticGateway,
    });

    const result1 = await strategy.selectGateway();
    const result2 = await strategy.selectGateway();
    const result3 = await strategy.selectGateway();

    assert.equal(
      result1.toString(),
      staticGateway,
      'Should return the static gateway',
    );
    assert.equal(
      result2.toString(),
      staticGateway,
      'Should return the static gateway',
    );
    assert.equal(
      result3.toString(),
      staticGateway,
      'Should return the static gateway even when no gateways are provided',
    );
  });

  it('logs a warning when gateways are provided', async () => {
    const staticGateway = 'https://static-example.com/';
    const testLogger = new TestLogger();

    const strategy = new StaticRoutingStrategy({
      gateway: staticGateway,
      logger: testLogger,
    });

    const providedGateways = [
      new URL('https://example1.com'),
      new URL('https://example2.com'),
    ];

    await strategy.selectGateway({ gateways: providedGateways });

    // Verify that a warning was logged
    assert.equal(testLogger.logs.length, 1);
    assert.equal(testLogger.logs[0].level, 'warn');
    assert.equal(
      testLogger.logs[0].message,
      'StaticRoutingStrategy does not accept provided gateways. Ignoring provided gateways...',
    );
    assert.equal(testLogger.logs[0].args[0].providedGateways, 2);
  });

  it('throws an error when an invalid URL is provided', () => {
    const testLogger = new TestLogger();

    assert.throws(
      () =>
        new StaticRoutingStrategy({
          gateway: 'not-a-valid-url',
          logger: testLogger,
        }),
      /Invalid URL/,
      'Should throw an error when an invalid URL is provided',
    );

    // Verify that an error was logged
    assert.equal(testLogger.logs.length, 1);
    assert.equal(testLogger.logs[0].level, 'error');
    assert.equal(
      testLogger.logs[0].message,
      'Invalid URL provided for static gateway',
    );
  });
});
