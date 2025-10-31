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
import { Logger } from './types.js';

/**
 * Basic fetch function that wraps the native fetch API.
 * This is the simplest implementation with no additional features.
 * @returns The native fetch function
 */
export const createBaseFetch = (): typeof globalThis.fetch => {
  return globalThis.fetch;
};

/**
 * Creates a composite fetch function that tries multiple fetch strategies in sequence.
 * Useful for fallback scenarios and resilient data fetching.
 * @param config Configuration for the composite fetch
 * @returns A fetch function that tries multiple strategies
 */
export const createCompositeFetch = ({
  fetchFns,
  logger,
}: {
  fetchFns: (typeof globalThis.fetch)[];
  logger?: Logger;
}): typeof globalThis.fetch => {
  return async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const errors: Error[] = [];

    for (let i = 0; i < fetchFns.length; i++) {
      const fetchFn = fetchFns[i];
      try {
        logger?.debug(`Trying fetcher ${i + 1} of ${fetchFns.length}`);
        const result = await fetchFn(input, init);

        // Check if response is successful (2xx status)
        if (result.ok) {
          return result;
        }

        // Non-2xx response, try next strategy
        logger?.warn(
          `Strategy ${i + 1} returned non-OK status: ${result.status}`,
        );
        errors.push(new Error(`HTTP ${result.status}: ${result.statusText}`));
      } catch (error) {
        logger?.error(`Strategy ${i + 1} failed: ${error}`);
        errors.push(error as Error);
      }
    }
    throw new Error(
      `All fetch strategies failed: ${errors.map((e) => e.message).join('; ')}`,
    );
  };
};
