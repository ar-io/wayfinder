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
  type ArweaveManifest,
  type ManifestRequestOptions,
  type ManifestVerificationProgress,
  Wayfinder,
  WayfinderURLParams,
} from '@ar.io/wayfinder-core';
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

/**
 * Hook for making manifest-aware requests with full verification
 *
 * This hook provides automatic verification of Arweave manifests and all their nested resources.
 * It handles manifest detection, parsing, recursive verification, and progress tracking.
 *
 * @param url - The ar:// URL to fetch
 * @param options - Manifest request options
 * @returns Object containing manifest data, verification state, and progress
 *
 * @example
 * ```tsx
 * function ManifestViewer({ txId }: { txId: string }) {
 *   const {
 *     data,
 *     manifest,
 *     isLoading,
 *     error,
 *     verificationProgress,
 *     allResourcesVerified
 *   } = useManifestRequest(`ar://${txId}`, {
 *     verifyNested: true,
 *   });
 *
 *   if (isLoading) return <div>Loading...</div>;
 *   if (error) return <div>Error: {error.message}</div>;
 *   if (!manifest) return <div>Not a manifest</div>;
 *
 *   return (
 *     <div>
 *       <h2>Manifest with {Object.keys(manifest.paths).length} resources</h2>
 *       <p>All verified: {allResourcesVerified ? 'Yes' : 'No'}</p>
 *     </div>
 *   );
 * }
 * ```
 */
export const useManifestRequest = (
  url: string,
  options?: ManifestRequestOptions,
) => {
  const { wayfinder } = useWayfinder();
  const memoizedUrl = useMemo(() => url, [url]);

  // Memoize options without onProgress to avoid infinite loops
  // onProgress is a callback that might change every render if defined inline
  const memoizedOptions = useMemo(
    () => ({
      verifyNested: options?.verifyNested,
      maxDepth: options?.maxDepth,
      concurrency: options?.concurrency,
    }),
    [options?.verifyNested, options?.maxDepth, options?.concurrency],
  );

  // Store latest onProgress callback in a ref to avoid triggering re-renders
  const onProgressRef = useCallback(
    (event: ManifestVerificationProgress) => {
      setVerificationProgress(event);
      options?.onProgress?.(event);
    },
    [options?.onProgress],
  );

  const [data, setData] = useState<ArrayBuffer | null>(null);
  const [manifest, setManifest] = useState<ArweaveManifest | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [verificationProgress, setVerificationProgress] =
    useState<ManifestVerificationProgress | null>(null);
  const [allResourcesVerified, setAllResourcesVerified] = useState(false);
  const [verificationResults, setVerificationResults] = useState<
    Map<string, { verified: boolean; error?: Error }>
  >(new Map());

  useEffect(() => {
    if (!memoizedUrl) {
      setData(null);
      setManifest(null);
      setError(null);
      setVerificationProgress(null);
      return;
    }

    // Track if this effect is still active
    let cancelled = false;

    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        // Make request with manifest verification
        const response = await wayfinder.requestWithManifest(memoizedUrl, {
          ...memoizedOptions,
          onProgress: onProgressRef,
        });

        // Check if effect was cancelled while awaiting
        if (cancelled) return;

        if (!response.ok) {
          throw new Error(
            `Failed to fetch: ${response.status} ${response.statusText}`,
          );
        }

        // Read the response data
        const arrayBuffer = await response.arrayBuffer();

        // Check again after async operation
        if (cancelled) return;

        setData(arrayBuffer);
        setManifest((response.manifest as ArweaveManifest) ?? null);
        setVerificationResults(response.verificationResults);
        setAllResourcesVerified(response.allVerified);
      } catch (err) {
        if (cancelled) return;

        setError(
          err instanceof Error ? err : new Error('Failed to fetch manifest'),
        );
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    // Cleanup function to prevent state updates after unmount
    return () => {
      cancelled = true;
    };
  }, [memoizedUrl, memoizedOptions, onProgressRef, wayfinder]);

  return {
    data,
    manifest,
    isLoading,
    error,
    verificationProgress,
    allResourcesVerified,
    verificationResults,
  };
};
