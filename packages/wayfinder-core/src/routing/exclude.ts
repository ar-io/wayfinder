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
 * Helpers for the optional `exclude` parameter of
 * `RoutingStrategy.selectGateway`. Gateways are compared by `toString()`, the
 * same identity `RoundRobinRoutingStrategy` uses to track its rotation.
 */

/**
 * Returns true when `gateway` is in `exclude`.
 */
export const isExcluded = (gateway: URL, exclude?: URL[]): boolean => {
  if (!exclude || exclude.length === 0) {
    return false;
  }
  const href = gateway.toString();
  return exclude.some((excluded) => excluded.toString() === href);
};

/**
 * Removes excluded gateways from `pool`. When every gateway in the pool is
 * excluded, returns the pool unchanged: retrying a gateway that failed once is
 * better than having nothing to try, and it is what happened before `exclude`
 * existed.
 */
export const withoutExcluded = (pool: URL[], exclude?: URL[]): URL[] => {
  if (!exclude || exclude.length === 0) {
    return pool;
  }
  const filtered = pool.filter((gateway) => !isExcluded(gateway, exclude));
  return filtered.length > 0 ? filtered : pool;
};
