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
import React, { createContext, useContext, useMemo } from 'react';
import type { Wayfinder, WayfinderOptions } from '@ar.io/wayfinder-core';

interface WayfinderContextValue {
  wayfinder: Wayfinder;
}

const WayfinderContext = createContext<WayfinderContextValue | undefined>(undefined);

export interface WayfinderProviderProps extends WayfinderOptions {
  children: React.ReactNode;
}

export const WayfinderProvider: React.FC<WayfinderProviderProps> = ({
  children,
  ...options
}) => {
  const wayfinder = useMemo(() => new Wayfinder(options), [options]);
  return (
    <WayfinderContext.Provider value={{ wayfinder }}>
      {children}
    </WayfinderContext.Provider>
  );
};

export const useWayfinder = (): WayfinderContextValue => {
  const context = useContext(WayfinderContext);
  if (!context) {
    throw new Error('useWayfinder must be used within a WayfinderProvider');
  }
  return context;
};

export const useWayfinderRequest = () => {
  const { wayfinder } = useWayfinder();
  return wayfinder.request;
};
