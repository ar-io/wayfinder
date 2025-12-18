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
import { describe, it } from 'node:test';
import { HashVerificationStrategy } from './hash-verification.js';
import { ManifestVerificationStrategy } from './manifest-verification.js';
import { RemoteVerificationStrategy } from './remote-verification.js';

describe('ManifestVerificationStrategy', () => {
  describe('Constructor Validation', () => {
    it('should accept HashVerificationStrategy with trusted gateways', () => {
      assert.doesNotThrow(() => {
        new ManifestVerificationStrategy({
          baseStrategy: new HashVerificationStrategy({
            trustedGateways: [new URL('https://arweave.net')],
          }),
        });
      });
    });

    it('should reject RemoteVerificationStrategy with clear error message', () => {
      assert.throws(
        () => {
          new ManifestVerificationStrategy({
            baseStrategy: new RemoteVerificationStrategy(),
          });
        },
        {
          message:
            /ManifestVerificationStrategy does not support RemoteVerificationStrategy/,
        },
      );
    });

    it('should include explanation in RemoteVerificationStrategy error', () => {
      try {
        new ManifestVerificationStrategy({
          baseStrategy: new RemoteVerificationStrategy(),
        });
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.match(
          error.message,
          /only checks x-ar-io-verified headers/,
          'Error should explain why RemoteVerificationStrategy is not supported',
        );
        assert.match(
          error.message,
          /fetch nested resources from trusted gateways/,
          'Error should explain what ManifestVerificationStrategy needs',
        );
      }
    });

    it('should suggest alternatives in RemoteVerificationStrategy error', () => {
      try {
        new ManifestVerificationStrategy({
          baseStrategy: new RemoteVerificationStrategy(),
        });
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.match(
          error.message,
          /HashVerificationStrategy/,
          'Error should suggest HashVerificationStrategy',
        );
        assert.match(
          error.message,
          /DataRootVerificationStrategy/,
          'Error should suggest DataRootVerificationStrategy',
        );
        assert.match(
          error.message,
          /SignatureVerificationStrategy/,
          'Error should suggest SignatureVerificationStrategy',
        );
      }
    });

    it('should reject strategies with empty trustedGateways array', () => {
      // Create a mock strategy with empty trustedGateways
      const mockStrategy = {
        trustedGateways: [],
        verifyData: async () => {
          /* noop */
        },
      };

      assert.throws(
        () => {
          new ManifestVerificationStrategy({
            baseStrategy: mockStrategy as any,
          });
        },
        {
          message: /requires at least one trusted gateway/,
        },
      );
    });

    it('should provide helpful error message for empty trustedGateways', () => {
      const mockStrategy = {
        constructor: { name: 'CustomStrategy' },
        trustedGateways: [],
        verifyData: async () => {
          /* noop */
        },
      };

      try {
        new ManifestVerificationStrategy({
          baseStrategy: mockStrategy as any,
        });
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.match(
          error.message,
          /must be configured with trustedGateways/,
          'Error should explain how to fix the problem',
        );
        assert.match(
          error.message,
          /HashVerificationStrategy|DataRootVerificationStrategy|SignatureVerificationStrategy/,
          'Error should suggest compatible strategies',
        );
      }
    });
  });

  describe('Configuration', () => {
    it('should use default maxDepth of 5', () => {
      const strategy = new ManifestVerificationStrategy({
        baseStrategy: new HashVerificationStrategy({
          trustedGateways: [new URL('https://arweave.net')],
        }),
      });

      // @ts-ignore - accessing private property for testing
      assert.strictEqual(strategy.maxDepth, 5);
    });

    it('should use default concurrency of 10', () => {
      const strategy = new ManifestVerificationStrategy({
        baseStrategy: new HashVerificationStrategy({
          trustedGateways: [new URL('https://arweave.net')],
        }),
      });

      // @ts-ignore - accessing private property for testing
      assert.strictEqual(strategy.concurrency, 10);
    });

    it('should accept custom maxDepth', () => {
      const strategy = new ManifestVerificationStrategy({
        baseStrategy: new HashVerificationStrategy({
          trustedGateways: [new URL('https://arweave.net')],
        }),
        maxDepth: 3,
      });

      // @ts-ignore - accessing private property for testing
      assert.strictEqual(strategy.maxDepth, 3);
    });

    it('should accept custom concurrency', () => {
      const strategy = new ManifestVerificationStrategy({
        baseStrategy: new HashVerificationStrategy({
          trustedGateways: [new URL('https://arweave.net')],
        }),
        concurrency: 5,
      });

      // @ts-ignore - accessing private property for testing
      assert.strictEqual(strategy.concurrency, 5);
    });
  });

  describe('Trusted Gateways', () => {
    it('should inherit trustedGateways from base strategy', () => {
      const trustedGateways = [
        new URL('https://arweave.net'),
        new URL('https://permagate.io'),
      ];

      const strategy = new ManifestVerificationStrategy({
        baseStrategy: new HashVerificationStrategy({
          trustedGateways,
        }),
      });

      assert.strictEqual(strategy.trustedGateways.length, 2);
      assert.strictEqual(
        strategy.trustedGateways[0].toString(),
        'https://arweave.net/',
      );
      assert.strictEqual(
        strategy.trustedGateways[1].toString(),
        'https://permagate.io/',
      );
    });
  });

  describe('Header Handling', () => {
    it('should handle Content-Type header case-insensitively', () => {
      const strategy = new ManifestVerificationStrategy({
        baseStrategy: new HashVerificationStrategy({
          trustedGateways: [new URL('https://arweave.net')],
        }),
      });

      // Test different casing variations
      const testCases = [
        { 'content-type': 'application/x.arweave-manifest+json' },
        { 'Content-Type': 'application/x.arweave-manifest+json' },
        { 'CONTENT-TYPE': 'application/x.arweave-manifest+json' },
        { 'Content-type': 'application/x.arweave-manifest+json' },
        { 'CoNtEnT-tYpE': 'application/x.arweave-manifest+json' },
      ];

      for (const headers of testCases) {
        // @ts-ignore - accessing private method for testing
        const result = strategy.isManifestContentType(headers);
        assert.strictEqual(
          result,
          true,
          `Should detect manifest with header: ${Object.keys(headers)[0]}`,
        );
      }
    });

    it('should handle JSON content-type case-insensitively', () => {
      const strategy = new ManifestVerificationStrategy({
        baseStrategy: new HashVerificationStrategy({
          trustedGateways: [new URL('https://arweave.net')],
        }),
      });

      // @ts-ignore - accessing private method for testing
      const result1 = strategy.getHeader(
        { 'content-type': 'application/json' },
        'content-type',
      );
      assert.strictEqual(result1, 'application/json');

      // @ts-ignore - accessing private method for testing
      const result2 = strategy.getHeader(
        { 'Content-Type': 'application/json' },
        'content-type',
      );
      assert.strictEqual(result2, 'application/json');

      // @ts-ignore - accessing private method for testing
      const result3 = strategy.getHeader(
        { 'CONTENT-TYPE': 'application/json' },
        'CoNtEnT-tYpE',
      );
      assert.strictEqual(result3, 'application/json');
    });

    it('should return undefined for missing headers', () => {
      const strategy = new ManifestVerificationStrategy({
        baseStrategy: new HashVerificationStrategy({
          trustedGateways: [new URL('https://arweave.net')],
        }),
      });

      // @ts-ignore - accessing private method for testing
      const result = strategy.getHeader({}, 'content-type');
      assert.strictEqual(result, undefined);
    });
  });
});
