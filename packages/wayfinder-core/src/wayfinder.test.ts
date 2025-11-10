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
import { before, describe, it } from 'node:test';

import { WayfinderEmitter } from './emitter.js';
import { TrustedPeersGatewaysProvider } from './gateways/trusted-peers.js';
import { RandomRoutingStrategy } from './routing/random.js';
import { StaticRoutingStrategy } from './routing/static.js';
import { GatewaysProvider, RoutingStrategy, WayfinderEvent } from './types.js';
import { HashVerificationStrategy } from './verification/hash-verification.js';
import { Wayfinder, createWayfinderUrl } from './wayfinder.js';

// TODO: replace with locally running gateway
const gatewayUrl = 'permagate.io';
const stubbedGatewaysProvider: GatewaysProvider = {
  getGateways: async () => [new URL(`https://${gatewayUrl}`)],
} as unknown as GatewaysProvider;

describe('Wayfinder', () => {
  describe('default configuration', () => {
    it('should use the default configuration', () => {
      const wayfinder = new Wayfinder();

      // gatewaysProvider is deprecated but maintained for backwards compatibility
      assert.ok(
        wayfinder.gatewaysProvider instanceof TrustedPeersGatewaysProvider,
      );
      // Check that the nested RandomRoutingStrategy has a gatewaysProvider
      const pingStrategy = wayfinder.routingSettings.strategy as any;
      assert.ok(pingStrategy.routingStrategy instanceof RandomRoutingStrategy);
      assert.ok(
        pingStrategy.routingStrategy.gatewaysProvider instanceof
          TrustedPeersGatewaysProvider,
      );

      // check the routing settings structure (without deep equality due to gatewaysProvider injection)
      assert.strictEqual(
        wayfinder.routingSettings.strategy.constructor.name,
        'PingRoutingStrategy',
      );
      assert.deepStrictEqual(wayfinder.routingSettings.events, {});
      // check the verification settings is disabled and has a stubbed out verification strategy
      assert.deepStrictEqual(wayfinder.verificationSettings, {
        strategy: undefined,
        enabled: false,
        strict: false,
        events: {},
      });
      // check the telemetry settings
      assert.deepStrictEqual(wayfinder.telemetrySettings, {
        enabled: false,
        sampleRate: undefined,
        apiKey: undefined,
        exporterUrl: undefined,
        clientName: undefined,
        clientVersion: undefined,
      });
    });
  });

  describe('request', () => {
    let wayfinder: Wayfinder;
    before(() => {
      wayfinder = new Wayfinder({
        routingSettings: {
          strategy: new RandomRoutingStrategy({
            gatewaysProvider: stubbedGatewaysProvider,
          }),
        },
      });
    });

    it('should fetch the data using the selected gateway', async () => {
      const [nativeFetch, response] = await Promise.all([
        fetch(`https://ao.${gatewayUrl}`),
        wayfinder.request('ar://ao'),
      ]);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.status, nativeFetch.status);
      // assert the arns headers are the same
      const arnsHeaders = Array.from(response.headers.entries()).filter(
        ([key]) => key.startsWith('x-arns-'),
      );
      const nativeFetchHeaders = Array.from(
        nativeFetch.headers.entries(),
      ).filter(([key]) => key.startsWith('x-arns-'));
      assert.deepStrictEqual(arnsHeaders, nativeFetchHeaders);
    });

    it('should fetch a tx id using the selected gateway', async () => {
      const [nativeFetch, response] = await Promise.all([
        fetch(
          `https://${gatewayUrl}/KKmRbIfrc7wiLcG0zvY1etlO0NBx1926dSCksxCIN3A`,
          // follow redirects
          { redirect: 'follow' },
        ),
        wayfinder.request('ar://KKmRbIfrc7wiLcG0zvY1etlO0NBx1926dSCksxCIN3A'),
      ]);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.status, nativeFetch.status);
    });

    it('should route a non-ar:// url as a normal fetch', async () => {
      const [nativeFetch, response] = await Promise.all([
        fetch(`https://${gatewayUrl}/`, {
          method: 'HEAD',
          redirect: 'follow',
        }),
        wayfinder.request(`https://${gatewayUrl}/`, { method: 'HEAD' }),
      ]);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.status, nativeFetch.status);
      // TODO: ensure the headers are the same excluding unique headers
    });

    for (const api of ['/info', '/block/current']) {
      it(`supports native arweave node apis ${api}`, async () => {
        const [nativeFetch, response] = await Promise.all([
          fetch(`https://${gatewayUrl}${api}`),
          wayfinder.request(`ar://${api}`),
        ]);
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.status, nativeFetch.status);
        // TODO: ensure the headers are the same excluding unique headers
      });
    }

    for (const api of ['/ar-io/info']) {
      it(`supports native ario node gateway apis ${api}`, async () => {
        const [nativeFetch, response] = await Promise.all([
          fetch(`https://${gatewayUrl}${api}`),
          wayfinder.request(`ar:///${api}`),
        ]);
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.status, nativeFetch.status);
        // TODO: ensure the headers are the same excluding unique headers
      });
    }

    it('supports a post request to graphql', async () => {
      const response = await wayfinder.request('ar:///graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: `
                query {
                  transactions(
                    ids: ["xf958qhCNGfDme1FtoiD6DtMfDENDbtxZpjOM_1tsMM"]
                  ) {
                    edges {
                      cursor
                      node {
                        id
                        tags {
                          name
                          value
                        }
                        block {
                          height
                          timestamp
                        }
                      }
                    }
                    pageInfo {
                      hasNextPage
                    }
                  }
                }
            `,
        }),
      });
      assert.strictEqual(response.status, 200);
    });

    it('returns the error from the target gateway if the route is not found', async () => {
      const [nativeFetch, response] = await Promise.all([
        fetch(`https://${gatewayUrl}/ar-io/not-found`),
        wayfinder.request('ar:///ar-io/not-found'),
      ]);
      assert.strictEqual(response.status, nativeFetch.status);
      assert.strictEqual(response.statusText, nativeFetch.statusText);
    });

    describe('selectGateway is called with correct parameters', () => {
      it('should call selectGateway with correct subdomain and path for ArNS names', async () => {
        let capturedParams: {
          gateways?: URL[];
          path?: string;
          subdomain?: string;
        } = { gateways: [] };

        const mockRoutingStrategy: RoutingStrategy = {
          selectGateway: async (params) => {
            capturedParams = params;
            return new URL(`http://${gatewayUrl}`);
          },
        };

        const wayfinder = new Wayfinder({
          verificationSettings: { enabled: false },
          routingSettings: { strategy: mockRoutingStrategy, events: {} },
        });

        // Mock global fetch to avoid network calls
        const originalFetch = global.fetch;
        global.fetch = async () => new Response('test', { status: 200 });

        try {
          await wayfinder.request('ar://myapp/dashboard/users');

          assert.ok(capturedParams, 'selectGateway should have been called');
          assert.strictEqual(
            capturedParams?.subdomain,
            'myapp',
            'Should extract ArNS name as subdomain',
          );
          assert.strictEqual(
            capturedParams?.path,
            '/dashboard/users',
            'Should extract remaining path',
          );
        } finally {
          global.fetch = originalFetch;
        }
      });

      it('should call selectGateway with correct subdomain and path for transaction IDs', async () => {
        let capturedParams: {
          gateways?: URL[];
          path?: string;
          subdomain?: string;
        } = { gateways: [] };

        const mockRoutingStrategy: RoutingStrategy = {
          selectGateway: async (params) => {
            capturedParams = params;
            return new URL(`http://${gatewayUrl}`);
          },
        };

        const wayfinder = new Wayfinder({
          verificationSettings: { enabled: false },
          routingSettings: { strategy: mockRoutingStrategy },
        });

        // Mock global fetch to avoid network calls
        const originalFetch = global.fetch;
        global.fetch = async () => new Response('test', { status: 200 });

        const txId = 'c7wkwt6TKgcWJUfgvpJ5q5qi4DIZyJ1_TqhjXgURh0U';
        const expectedSandbox =
          'oo6cjqw6smvaofrfi7ql5etzvonkfybsdhej272ovbrv4birq5cq';

        try {
          await wayfinder.request(`ar://${txId}/path/to/app`);

          assert.ok(capturedParams, 'selectGateway should have been called');
          assert.strictEqual(
            capturedParams?.subdomain,
            expectedSandbox,
            'Should extract sandbox as subdomain for transaction ID',
          );
          assert.strictEqual(
            capturedParams?.path,
            `/${txId}/path/to/app`,
            'Should include transaction ID and path',
          );
        } finally {
          global.fetch = originalFetch;
        }
      });

      it('should call selectGateway with correct parameters for gateway endpoints', async () => {
        let capturedParams: {
          gateways?: URL[];
          path?: string;
          subdomain?: string;
        } = { gateways: [] };

        const mockRoutingStrategy: RoutingStrategy = {
          selectGateway: async (params) => {
            capturedParams = params;
            return new URL(`http://${gatewayUrl}`);
          },
        };

        const mockGatewaysProvider: GatewaysProvider = {
          getGateways: async () => [new URL(`http://${gatewayUrl}`)],
        };

        const wayfinder = new Wayfinder({
          gatewaysProvider: mockGatewaysProvider,
          verificationSettings: { enabled: false },
          routingSettings: { strategy: mockRoutingStrategy },
        });

        // Mock global fetch to avoid network calls
        const originalFetch = global.fetch;
        global.fetch = async () => new Response('test', { status: 200 });

        try {
          await wayfinder.request('ar:///ar-io/info');

          assert.ok(capturedParams, 'selectGateway should have been called');
          assert.strictEqual(
            capturedParams?.subdomain,
            '',
            'Should have empty subdomain for gateway endpoints',
          );
          assert.strictEqual(
            capturedParams?.path,
            '/ar-io/info',
            'Should pass through gateway endpoint path',
          );
        } finally {
          global.fetch = originalFetch;
        }
      });

      it('should call selectGateway with correct parameters for ArNS names without paths', async () => {
        let capturedParams: {
          gateways?: URL[];
          path?: string;
          subdomain?: string;
        } = { gateways: [] };

        const mockRoutingStrategy: RoutingStrategy = {
          selectGateway: async (params) => {
            capturedParams = params;
            return new URL(`http://${gatewayUrl}`);
          },
        };

        const mockGatewaysProvider: GatewaysProvider = {
          getGateways: async () => [new URL(`http://${gatewayUrl}`)],
        };

        const wayfinder = new Wayfinder({
          gatewaysProvider: mockGatewaysProvider,
          verificationSettings: { enabled: false },
          routingSettings: { strategy: mockRoutingStrategy },
        });

        // Mock global fetch to avoid network calls
        const originalFetch = global.fetch;
        global.fetch = async () => new Response('test', { status: 200 });

        try {
          await wayfinder.request('ar://myapp');

          assert.ok(capturedParams, 'selectGateway should have been called');
          assert.strictEqual(
            capturedParams?.subdomain,
            'myapp',
            'Should extract ArNS name as subdomain',
          );
          assert.strictEqual(
            capturedParams?.path,
            '/',
            'Should default to root path for ArNS names without paths',
          );
        } finally {
          global.fetch = originalFetch;
        }
      });
    });
  });

  describe('events', () => {
    it('should emit default events on the wayfinder event emitter when request is made', async () => {
      const wayfinder = new Wayfinder({
        gatewaysProvider: stubbedGatewaysProvider,
        routingSettings: {
          strategy: new StaticRoutingStrategy({
            gateway: `http://${gatewayUrl}`,
          }),
        },
        verificationSettings: {
          strategy: {
            trustedGateways: [new URL(`http://${gatewayUrl}`)],
            verifyData: async () => {
              // do nothing
              return;
            },
          },
        },
      });
      const events: unknown[] = [];
      wayfinder.emitter.on('verification-failed', (event) => {
        events.push({ type: 'verification-failed', ...event });
      });
      wayfinder.emitter.on('verification-progress', (event) => {
        events.push({ type: 'verification-progress', ...event });
      });
      wayfinder.emitter.on('verification-succeeded', (event) => {
        events.push({ type: 'verification-succeeded', ...event });
      });
      // request data and assert the event is emitted
      const response = await wayfinder.request(
        'ar://c7wkwt6TKgcWJUfgvpJ5q5qi4DIZyJ1_TqhjXgURh0U',
      );
      // read the full response body to ensure the stream is fully consumed
      await response.text();
      assert.strictEqual(response.status, 200);
      assert.ok(
        events.find((e: any) => e.type === 'verification-succeeded'),
        'Should emit at least one verification-succeeded',
      );
    });

    it('should emit events and trigger request callbacks when request is made with custom events, and not emit global events', async () => {
      const wayfinder = new Wayfinder({
        gatewaysProvider: stubbedGatewaysProvider,
        routingSettings: {
          strategy: new StaticRoutingStrategy({
            gateway: `http://${gatewayUrl}`,
          }),
        },
        verificationSettings: {
          strategy: {
            trustedGateways: [new URL(`http://${gatewayUrl}`)],
            verifyData: async () => {
              // do nothing
              return;
            },
          },
        },
      });

      const requestEvents: unknown[] = [];
      // call request with custom callbacks
      const response = await wayfinder.request(
        'ar://c7wkwt6TKgcWJUfgvpJ5q5qi4DIZyJ1_TqhjXgURh0U',
        {
          verificationSettings: {
            events: {
              onVerificationFailed: (
                event: WayfinderEvent['verification-failed'],
              ) => {
                requestEvents.push({ type: 'verification-failed', ...event });
              },
              onVerificationProgress: (
                event: WayfinderEvent['verification-progress'],
              ) => {
                requestEvents.push({ type: 'verification-progress', ...event });
              },
              onVerificationSucceeded: (
                event: WayfinderEvent['verification-succeeded'],
              ) => {
                requestEvents.push({
                  type: 'verification-succeeded',
                  ...event,
                });
              },
            },
          },
          routingSettings: {
            events: {
              onRoutingStarted: (event: WayfinderEvent['routing-started']) => {
                requestEvents.push({ type: 'routing-started', ...event });
              },
              onRoutingSkipped: (event: WayfinderEvent['routing-skipped']) => {
                requestEvents.push({ type: 'routing-skipped', ...event });
              },
              onRoutingSucceeded: (
                event: WayfinderEvent['routing-succeeded'],
              ) => {
                requestEvents.push({ type: 'routing-succeeded', ...event });
              },
            },
          },
        },
      );
      // read the full response body to ensure the stream is fully consumed
      await response.text();
      assert.strictEqual(response.status, 200);

      // request events should have been emitted
      assert.ok(
        requestEvents.find((e: any) => e.type === 'routing-started'),
        'Should have triggered the routing-started callback',
      );
      assert.ok(
        !requestEvents.find((e: any) => e.type === 'routing-skipped'),
        'Should not have triggered the routing-skipped callback',
      );
      assert.ok(
        requestEvents.find((e: any) => e.type === 'routing-succeeded'),
        'Should have triggered the routing-succeeded callback',
      );
      assert.ok(
        !requestEvents.find((e: any) => e.type === 'verification-failed'),
        'Should not have triggered the verification-failed callback',
      );
      assert.ok(
        requestEvents.find((e: any) => e.type === 'verification-progress'),
        'Should have triggered the verification-progress callback',
      );
      assert.ok(
        requestEvents.find((e: any) => e.type === 'verification-succeeded'),
        'Should have triggered the verification-succeeded callback',
      );
    });

    it('should execute callbacks provided to the wayfinder constructor', async () => {
      let verificationFailed = false;
      let verificationProgress = false;
      let verificationSucceeded = false;
      const wayfinder = new Wayfinder({
        routingSettings: {
          strategy: new StaticRoutingStrategy({
            gateway: `http://${gatewayUrl}`,
          }),
        },
        verificationSettings: {
          strict: true,
          strategy: new HashVerificationStrategy({
            trustedGateways: [new URL(`http://${gatewayUrl}`)],
          }),
          events: {
            onVerificationFailed: () => {
              verificationFailed = true;
            },
            onVerificationProgress: () => {
              verificationProgress = true;
            },
            onVerificationSucceeded: () => {
              verificationSucceeded = true;
            },
          },
        },
      });
      const response = await wayfinder.request(
        'ar://c7wkwt6TKgcWJUfgvpJ5q5qi4DIZyJ1_TqhjXgURh0U',
      );
      // read the full response body to ensure the stream is fully consumed
      await response.text();
      assert.strictEqual(response.status, 200);
      assert.ok(
        verificationFailed === false,
        'Should not emit verification-failed',
      );
      assert.ok(verificationProgress, 'Should emit verification-progress');
      assert.ok(verificationSucceeded, 'Should emit verification-succeeded');
    });

    it('should call verification for ArNS names with resolved transaction ID', async () => {
      let verifyDataCalled = false;
      let verifyDataCalledWithTxId: string | undefined;

      const wayfinder = new Wayfinder({
        routingSettings: {
          strategy: new StaticRoutingStrategy({
            gateway: `http://${gatewayUrl}`,
          }),
        },
        verificationSettings: {
          strategy: {
            trustedGateways: [new URL(`http://${gatewayUrl}`)],
            verifyData: async ({ txId }) => {
              verifyDataCalled = true;
              verifyDataCalledWithTxId = txId;
              return;
            },
          },
        },
      });

      // Request an ArNS name - this should resolve to a txId and call verification
      const response = await wayfinder.request('ar://ardrive');

      // Read the full response body to ensure verification completes
      await response.text();

      assert.strictEqual(response.status, 200);
      assert.ok(
        verifyDataCalled,
        'verifyData should have been called for ArNS name',
      );
      assert.ok(
        verifyDataCalledWithTxId,
        'verifyData should have been called with resolved txId',
      );
      assert.match(
        verifyDataCalledWithTxId!,
        /^[A-Za-z0-9_-]{43}$/,
        'Should be called with a valid 43-character transaction ID',
      );
    });
  });

  describe('resolveUrl', () => {
    let wayfinder: Wayfinder;
    before(() => {
      wayfinder = new Wayfinder({
        routingSettings: {
          strategy: new StaticRoutingStrategy({
            gateway: `http://${gatewayUrl}`,
          }),
        },
      });
    });

    describe('Gateway endpoint routing (path starts with /)', () => {
      it('should route to gateway endpoints correctly', async () => {
        const resolvedUrl = await wayfinder.resolveUrl({
          originalUrl: 'ar:///ar-io/info',
        });

        assert.strictEqual(
          resolvedUrl.toString(),
          `http://${gatewayUrl}/ar-io/info`,
        );
      });

      it('should route single-level gateway endpoints', async () => {
        const result = await wayfinder.resolveUrl({
          originalUrl: 'ar:///info',
        });

        assert.strictEqual(result.toString(), `http://${gatewayUrl}/info`);
      });

      it('should route gateway endpoints with query params', async () => {
        const result = await wayfinder.resolveUrl({
          originalUrl: 'ar:///graphql?query=test',
        });

        assert.strictEqual(
          result.toString(),
          `http://${gatewayUrl}/graphql?query=test`,
        );
      });

      it('should handle empty gateway endpoint (just ar:///)', async () => {
        const result = await wayfinder.resolveUrl({
          originalUrl: 'ar:///',
        });

        assert.strictEqual(result.toString(), `http://${gatewayUrl}/`);
      });
    });

    describe('Transaction ID routing (txIdRegex)', () => {
      const validTxId = 'c7wkwt6TKgcWJUfgvpJ5q5qi4DIZyJ1_TqhjXgURh0U';
      const sandboxForTxId =
        'oo6cjqw6smvaofrfi7ql5etzvonkfybsdhej272ovbrv4birq5cq';

      it('should resolve transaction IDs without path components to the proper sandbox url', async () => {
        const resolvedUrl = await wayfinder.resolveUrl({
          originalUrl: `ar://${validTxId}`,
        });

        assert.strictEqual(
          resolvedUrl.toString(),
          `http://${sandboxForTxId}.${gatewayUrl}/${validTxId}`,
        );
      });

      it('should resolve transaction IDs with path segments', async () => {
        const resolvedUrl = await wayfinder.resolveUrl({
          originalUrl: `ar://${validTxId}/path/to/file.html`,
        });

        assert.strictEqual(
          resolvedUrl.toString(),
          `http://${sandboxForTxId}.${gatewayUrl}/${validTxId}/path/to/file.html`,
        );
      });

      it('should route transaction IDs with multiple path segments', async () => {
        const result = await wayfinder.resolveUrl({
          originalUrl: `ar://${validTxId}/assets/images/logo.png`,
        });

        assert.strictEqual(
          result.toString(),
          `http://${sandboxForTxId}.${gatewayUrl}/${validTxId}/assets/images/logo.png`,
        );
      });

      it('should route transaction IDs with query parameters', async () => {
        const result = await wayfinder.resolveUrl({
          originalUrl: `ar://${validTxId}/api/data?format=json&limit=50`,
        });

        assert.strictEqual(
          result.toString(),
          `http://${sandboxForTxId}.${gatewayUrl}/${validTxId}/api/data?format=json&limit=50`,
        );
      });
    });

    describe('ARNS name routing (arnsRegex)', () => {
      describe('Basic ARNS names with path components', () => {
        it('should resolve ARNS names without path components', async () => {
          const resolvedUrl = await wayfinder.resolveUrl({
            originalUrl: 'ar://cookbook_ao',
          });

          assert.strictEqual(
            resolvedUrl.toString(),
            `http://cookbook_ao.${gatewayUrl}/`,
          );
        });

        it('should resolve top-level ARNS names with single path segment', async () => {
          const resolvedUrl = await wayfinder.resolveUrl({
            originalUrl: 'ar://ao/welcome',
          });

          assert.strictEqual(
            resolvedUrl.toString(),
            `http://ao.${gatewayUrl}/welcome`,
          );
        });

        it('should resolve top-level ARNS names with multiple path segments', async () => {
          const resolvedUrl = await wayfinder.resolveUrl({
            originalUrl: 'ar://ao/welcome/getting-started.html',
          });

          assert.strictEqual(
            resolvedUrl.toString(),
            `http://ao.${gatewayUrl}/welcome/getting-started.html`,
          );
        });

        it('should resolve ARNS names with undernames and single path segment', async () => {
          const resolvedUrl = await wayfinder.resolveUrl({
            originalUrl: 'ar://cookbook_ao/welcome',
          });

          assert.strictEqual(
            resolvedUrl.toString(),
            `http://cookbook_ao.${gatewayUrl}/welcome`,
          );
        });

        it('should resolve ARNS names with undernames and multiple path segments', async () => {
          const resolvedUrl = await wayfinder.resolveUrl({
            originalUrl: 'ar://cookbook_ao/welcome/getting-started.html',
          });

          assert.strictEqual(
            resolvedUrl.toString(),
            `http://cookbook_ao.${gatewayUrl}/welcome/getting-started.html`,
          );
        });

        it('should resolve ARNS names with deep nested paths', async () => {
          const resolvedUrl = await wayfinder.resolveUrl({
            originalUrl: 'ar://cookbook_ao/api/v1/users/123/profile',
          });

          assert.strictEqual(
            resolvedUrl.toString(),
            `http://cookbook_ao.${gatewayUrl}/api/v1/users/123/profile`,
          );
        });
      });

      describe('ARNS names with special characters', () => {
        it('should route ARNS names with hyphens', async () => {
          const result = await wayfinder.resolveUrl({
            originalUrl: 'ar://my-app/dashboard',
          });

          assert.strictEqual(
            result.toString(),
            `http://my-app.${gatewayUrl}/dashboard`,
          );
        });

        it('should route ARNS names with numbers', async () => {
          const result = await wayfinder.resolveUrl({
            originalUrl: 'ar://app2024/features',
          });

          assert.strictEqual(
            result.toString(),
            `http://app2024.${gatewayUrl}/features`,
          );
        });
      });

      describe('ARNS names with query parameters', () => {
        it('should preserve query parameters in ARNS routing', async () => {
          const result = await wayfinder.resolveUrl({
            originalUrl: 'ar://cookbook_ao/search?q=testing&category=tutorials',
          });

          assert.strictEqual(
            result.toString(),
            `http://cookbook_ao.${gatewayUrl}/search?q=testing&category=tutorials`,
          );
        });
      });

      describe('Edge cases for valid ARNS names', () => {
        it('should handle single character ARNS names', async () => {
          const result = await wayfinder.resolveUrl({
            originalUrl: 'ar://x/path',
          });

          assert.strictEqual(result.toString(), `http://x.${gatewayUrl}/path`);
        });

        it('should handle maximum length ARNS names (51 chars)', async () => {
          const maxLengthName = 'a'.repeat(51);
          const result = await wayfinder.resolveUrl({
            originalUrl: `ar://${maxLengthName}/test`,
          });

          assert.strictEqual(
            result.toString(),
            `http://${maxLengthName}.${gatewayUrl}/test`,
          );
        });

        it('should treat short IDs as ARNS names when they match arnsRegex', async () => {
          const shortId = 'abc123';
          const originalUrl = `ar://${shortId}/path`;
          const result = await wayfinder.resolveUrl({
            originalUrl,
          });

          // Short IDs that don't match txIdRegex but match arnsRegex get treated as ARNS names
          assert.strictEqual(
            result.toString(),
            `http://${shortId}.${gatewayUrl}/path`,
          );
        });

        it('should treat long IDs as ARNS names when they match arnsRegex', async () => {
          const longId = 'a'.repeat(44);
          const originalUrl = `ar://${longId}/path`;
          const result = await wayfinder.resolveUrl({
            originalUrl,
          });

          // Long IDs that don't match txIdRegex but match arnsRegex get treated as ARNS names
          assert.strictEqual(
            result.toString(),
            `http://${longId}.${gatewayUrl}/path`,
          );
        });
      });
    });

    describe('Invalid names (no regex match - fallback)', () => {
      it('should fallback for ARNS names that are too long (>51 chars)', async () => {
        const tooLongName = 'a'.repeat(52);
        const originalUrl = `ar://${tooLongName}/path`;
        const result = await wayfinder.resolveUrl({
          originalUrl,
        });

        assert.strictEqual(
          result.toString(),
          `http://${gatewayUrl}/${tooLongName}/path`,
        );
      });

      it('should fallback for names with invalid characters', async () => {
        const invalidName = 'my.app';
        const originalUrl = `ar://${invalidName}/path`;
        const result = await wayfinder.resolveUrl({
          originalUrl,
        });

        assert.strictEqual(
          result.toString(),
          `http://${gatewayUrl}/my.app/path`,
        );
      });

      it('should fallback for names with uppercase letters', async () => {
        const upperCaseName = 'MyApp';
        const originalUrl = `ar://${upperCaseName}/path`;
        const result = await wayfinder.resolveUrl({
          originalUrl,
        });

        assert.strictEqual(
          result.toString(),
          `http://${upperCaseName.toLowerCase()}.${gatewayUrl}/path`,
        );
      });

      it('should fallback for empty path', async () => {
        const originalUrl = 'ar://';
        const result = await wayfinder.resolveUrl({
          originalUrl,
        });

        assert.strictEqual(result.toString(), `http://${gatewayUrl}/`);
      });
    });

    describe('Non-ar:// URLs', () => {
      it('should throw error for non-ar:// URLs', async () => {
        await assert.rejects(
          wayfinder.resolveUrl({
            originalUrl: 'https://example.com/path',
          }),
          { message: 'Invalid URL' },
        );
      });
    });
  });
});

describe('createWayfinderUrl', () => {
  describe('originalUrl parameter', () => {
    it('should parse arweave.net URL with transaction ID', () => {
      const result = createWayfinderUrl({
        originalUrl:
          'https://arweave.net/abc123def456ghi789jkl012mno345pqr678stu901vwx',
      });
      assert.strictEqual(
        result,
        'ar://abc123def456ghi789jkl012mno345pqr678stu901vwx',
      );
    });

    it('should parse arweave.dev URL with transaction ID', () => {
      const result = createWayfinderUrl({
        originalUrl:
          'https://arweave.dev/abc123def456ghi789jkl012mno345pqr678stu901vwx',
      });
      assert.strictEqual(
        result,
        'ar://abc123def456ghi789jkl012mno345pqr678stu901vwx',
      );
    });
    it('should handle URLs with additional path segments', () => {
      const result = createWayfinderUrl({
        originalUrl:
          'https://arweave.net/abc123def456ghi789jkl012mno345pqr678stu901vwx/path/to/file',
      });
      assert.strictEqual(
        result,
        'ar://abc123def456ghi789jkl012mno345pqr678stu901vwx/path/to/file',
      );
    });

    it('should handle URLs with query parameters', () => {
      const result = createWayfinderUrl({
        originalUrl:
          'https://arweave.net/abc123def456ghi789jkl012mno345pqr678stu901vwx?param=value',
      });
      assert.strictEqual(
        result,
        'ar://abc123def456ghi789jkl012mno345pqr678stu901vwx',
      );
    });

    it('should handle URLs with hash fragments', () => {
      const result = createWayfinderUrl({
        originalUrl:
          'https://arweave.net/abc123def456ghi789jkl012mno345pqr678stu901vwx#section',
      });
      assert.strictEqual(
        result,
        'ar://abc123def456ghi789jkl012mno345pqr678stu901vwx',
      );
    });

    it('should throw error for invalid hostname', () => {
      assert.throws(
        () => {
          createWayfinderUrl({
            originalUrl:
              'https://invalid-host.com/abc123def456ghi789jkl012mno345pqr678stu901vwx',
          });
        },
        { message: 'Invalid URL' },
      );
    });
  });

  describe('wayfinderUrl parameter', () => {
    it('should return wayfinderUrl as-is when already in ar:// format', () => {
      const wayfinderUrl = 'ar://abc123def456ghi789jkl012mno345pqr678stu901vwx';
      const result = createWayfinderUrl({ wayfinderUrl });
      assert.strictEqual(result, wayfinderUrl);
    });

    it('should handle wayfinderUrl with ArNS name', () => {
      const wayfinderUrl = 'ar://my-arns-name';
      const result = createWayfinderUrl({ wayfinderUrl });
      assert.strictEqual(result, wayfinderUrl);
    });

    it('should handle wayfinderUrl with path segments', () => {
      const wayfinderUrl =
        'ar://abc123def456ghi789jkl012mno345pqr678stu901vwx/path/to/file';
      const result = createWayfinderUrl({ wayfinderUrl });
      assert.strictEqual(result, wayfinderUrl);
    });
  });

  describe('txId parameter', () => {
    it('should wrap transaction ID with ar:// protocol', () => {
      const result = createWayfinderUrl({
        txId: 'abc123def456ghi789jkl012mno345pqr678stu901vwx',
      });
      assert.strictEqual(
        result,
        'ar://abc123def456ghi789jkl012mno345pqr678stu901vwx',
      );
    });

    it('should handle short transaction ID', () => {
      const result = createWayfinderUrl({
        txId: 'abc123',
      });
      assert.strictEqual(result, 'ar://abc123');
    });

    it('should handle transaction ID with special characters', () => {
      const result = createWayfinderUrl({
        txId: 'abc-123_DEF',
      });
      assert.strictEqual(result, 'ar://abc-123_DEF');
    });
  });

  describe('arnsName parameter', () => {
    it('should wrap ArNS name with ar:// protocol', () => {
      const result = createWayfinderUrl({
        arnsName: 'my-arns-name',
      });
      assert.strictEqual(result, 'ar://my-arns-name');
    });

    it('should handle ArNS name with underscores', () => {
      const result = createWayfinderUrl({
        arnsName: 'my_arns_name',
      });
      assert.strictEqual(result, 'ar://my_arns_name');
    });

    it('should handle ArNS name with numbers', () => {
      const result = createWayfinderUrl({
        arnsName: 'arns123',
      });
      assert.strictEqual(result, 'ar://arns123');
    });
  });

  describe('error handling', () => {
    it('should throw error when no valid parameters are provided', () => {
      assert.throws(
        () => {
          createWayfinderUrl({} as any);
        },
        {
          message:
            'Invalid URL params, only one of the following is allowed: originalUrl, wayfinderUrl, txId, arnsName',
        },
      );
    });

    it('should throw error when multiple parameters are provided', () => {
      assert.throws(
        () => {
          createWayfinderUrl({
            txId: 'abc123',
            arnsName: 'my-arns',
          } as any);
        },
        {
          message:
            'Invalid URL params, only one of the following is allowed: originalUrl, wayfinderUrl, txId, arnsName',
        },
      );
    });
  });
});
