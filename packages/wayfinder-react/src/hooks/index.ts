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

import { Wayfinder, WayfinderURLParams } from '@ar.io/wayfinder-core';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  WayfinderContext,
  type WayfinderContextValue,
} from '../components/wayfinder-provider.js';

/**
 * Hook for getting the Wayfinder instance
 * @returns Wayfinder instance
 */
export const useWayfinder = (): WayfinderContextValue => {
  const context = useContext(WayfinderContext);
  if (!context) {
    throw new Error('useWayfinder must be used within a WayfinderProvider');
  }
  return context;
};

/**
 * Hook for getting the Wayfinder request function
 * @returns Wayfinder request function
 */
export const useWayfinderRequest = (): Wayfinder['request'] => {
  const { wayfinder } = useWayfinder();
  return useCallback(
    (url: URL | RequestInfo) => wayfinder.request(url),
    [wayfinder],
  );
};

/**
 * Hook for resolving a transaction ID to a WayFinder URL using the Wayfinder instance (e.g. txId -> https://<some-gateway>/txId)
 * @param txId - The transaction ID to resolve
 * @returns Object containing the resolved URL and loading state
 */
export const useWayfinderUrl = (params: WayfinderURLParams) => {
  const { wayfinder } = useWayfinder();
  const memoizedParams = useMemo(() => params, [JSON.stringify(params)]);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!memoizedParams) {
      setResolvedUrl(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        const resolved = await wayfinder.resolveUrl(memoizedParams);
        setResolvedUrl(resolved.toString());
      } catch (err) {
        setError(
          err instanceof Error ? err : new Error('Failed to resolve URL'),
        );
      } finally {
        setIsLoading(false);
      }
    })();
  }, [memoizedParams, wayfinder]);

  return { resolvedUrl, isLoading, error };
};
