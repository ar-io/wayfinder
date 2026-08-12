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
import {
  LocalStorageGatewaysProvider,
  Wayfinder,
  type WayfinderOptions,
  createCachedGatewaysProvider,
} from '@ar.io/wayfinder-core';
import React, { createContext, useMemo } from 'react';
import { WAYFINDER_REACT_VERSION } from '../version.js';

export interface WayfinderContextValue {
  wayfinder: Wayfinder;
}

export const WayfinderContext = createContext<
  WayfinderContextValue | undefined
>(undefined);

export interface WayfinderProviderProps extends WayfinderOptions {
  children: React.ReactNode;
}

export const WayfinderProvider: React.FC<WayfinderProviderProps> = ({
  children,
  ...options
}) => {
  const {
    gatewaysProvider: suppliedGatewaysProvider,
    routingSettings,
    verificationSettings,
    telemetrySettings,
    dataRetrievalStrategy,
    logger,
    fetch: fetchImplementation,
  } = options;

  /**
   * Always hand Wayfinder a cached provider.
   *
   * Wayfinder's own default is uncached — only `createWayfinderClient()` adds
   * caching, and even there only when no `routingSettings` are supplied. In a
   * browser that means re-reading the gateway list far more often than the
   * 5-minute TTL implies, so the default source is wrapped here too rather than
   * only a caller-supplied one.
   */
  const gatewaysProvider = useMemo(() => {
    // Already cached — don't double-wrap.
    if (suppliedGatewaysProvider instanceof LocalStorageGatewaysProvider) {
      return suppliedGatewaysProvider;
    }
    // Picks localStorage in the browser and an in-memory cache elsewhere, so
    // this stays safe under server-side rendering.
    return createCachedGatewaysProvider({
      gatewaysProvider: suppliedGatewaysProvider,
      logger,
    });
  }, [suppliedGatewaysProvider, logger]);

  /**
   * Depend on the individual options, never on the rest object.
   *
   * `options` comes from a rest spread, so it is a fresh object on every single
   * render — memoising on it rebuilt the client (and its providers, emitter and
   * telemetry) every time this component rendered, no matter what the caller
   * passed.
   */
  const wayfinder = useMemo(
    () =>
      new Wayfinder({
        ...options,
        gatewaysProvider,
        telemetrySettings: {
          enabled: false,
          clientName: 'wayfinder-react',
          clientVersion: WAYFINDER_REACT_VERSION,
          ...telemetrySettings,
        },
      }),
    // `options` is intentionally absent from these dependencies: it is a new
    // object each render, so the fields it carries are the real dependencies.
    [
      gatewaysProvider,
      routingSettings,
      verificationSettings,
      telemetrySettings,
      dataRetrievalStrategy,
      logger,
      fetchImplementation,
    ],
  );

  // Stable context value, so consumers don't re-render on every parent render.
  const value = useMemo(() => ({ wayfinder }), [wayfinder]);

  return (
    <WayfinderContext.Provider value={value}>
      {children}
    </WayfinderContext.Provider>
  );
};
