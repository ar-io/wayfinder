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

/**
 * These run under `react-test-renderer`, which needs no DOM — the assertions
 * are about what the provider builds, not about what it paints. Running in
 * plain Node also means the suite fails if the provider ever reaches for a
 * browser-only API, which is the server-side-rendering case.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { StaticGatewaysProvider } from '@ar.io/wayfinder-core';
import React, { useContext } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { WayfinderContext } from './wayfinder-provider.js';
import { WayfinderProvider } from './wayfinder-provider.js';

/** Records the client seen on each render. */
function makeProbe(seen: unknown[]) {
  return () => {
    seen.push(useContext(WayfinderContext)?.wayfinder);
    return null;
  };
}

describe('WayfinderProvider', () => {
  /**
   * Props are collected with a rest spread, so the options object is a new
   * reference on every render. Memoising on it rebuilt the client — and its
   * gateways provider, emitter and telemetry — on every single render.
   */
  it('does not rebuild the client across re-renders', async () => {
    const seen: unknown[] = [];
    const Probe = makeProbe(seen);
    let renderer: TestRenderer.ReactTestRenderer | undefined;

    const tree = (n: number) => (
      <WayfinderProvider>
        <Probe key="probe" />
        <span>{n}</span>
      </WayfinderProvider>
    );

    await act(async () => {
      renderer = TestRenderer.create(tree(1));
    });
    await act(async () => {
      renderer?.update(tree(2));
    });
    await act(async () => {
      renderer?.update(tree(3));
    });

    assert.ok(seen.length >= 3, `expected >= 3 renders, saw ${seen.length}`);
    assert.strictEqual(
      new Set(seen).size,
      1,
      `client was rebuilt ${new Set(seen).size} times across ${seen.length} renders`,
    );
  });

  it('builds a client without a browser present', async () => {
    const seen: unknown[] = [];
    const Probe = makeProbe(seen);

    // Constructing outside a browser must not throw: LocalStorageGatewaysProvider
    // is browser-only, so the cache wrapper has to be chosen conditionally.
    await act(async () => {
      TestRenderer.create(
        <WayfinderProvider>
          <Probe />
        </WayfinderProvider>,
      );
    });

    assert.ok(seen[0], 'expected a wayfinder instance in context');
  });

  it('keeps using a caller-supplied gateways provider', async () => {
    const seen: unknown[] = [];
    const Probe = makeProbe(seen);
    const supplied = new StaticGatewaysProvider({
      gateways: ['https://supplied.example'],
    });

    await act(async () => {
      TestRenderer.create(
        <WayfinderProvider gatewaysProvider={supplied}>
          <Probe />
        </WayfinderProvider>,
      );
    });

    const wayfinder = seen[0] as {
      gatewaysProvider: { getGateways(): Promise<URL[]> };
    };
    const gateways = await wayfinder.gatewaysProvider.getGateways();

    assert.deepStrictEqual(
      gateways.map((gateway) => gateway.host),
      ['supplied.example'],
    );
  });
});
