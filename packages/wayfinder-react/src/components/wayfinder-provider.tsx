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
import { Wayfinder, type WayfinderOptions } from '@ar.io/wayfinder-core';
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
  const wayfinder = useMemo(
    () =>
      new Wayfinder({
        ...options,
        telemetrySettings: {
          enabled: false,
          clientName: 'wayfinder-react',
          clientVersion: WAYFINDER_REACT_VERSION,
          ...options.telemetrySettings,
        },
      }),
    [options],
  );
  return (
    <WayfinderContext.Provider value={{ wayfinder }}>
      {children}
    </WayfinderContext.Provider>
  );
};
