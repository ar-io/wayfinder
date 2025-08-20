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
import { ARIO } from '@ar.io/sdk';
import { Wayfinder } from '@ar.io/wayfinder-core';

const wayfinder = new Wayfinder();
const ario = ARIO.mainnet();

async function main() {
  // fetch all the arns names
  const arnsNames = [];
  let cursor = undefined;
  while (true) {
    const {
      items: newRecords,
      nextCursor,
      hasMore: nextHasMore,
    } = await ario.getArNSRecords({ limit: 1000, cursor });
    arnsNames.push(...newRecords.map((r) => r.name));
    if (!nextHasMore) {
      break;
    }
    cursor = nextCursor;
  }

  const resolvedNames = await Promise.all(
    arnsNames.map(async (name) => {
      const response = await wayfinder.request(`ar:///ar-io/resolver/${name}`);

      // if bad response, return null
      if (!response.ok) {
        return null;
      }

      const arnsResolution = await response.json();

      // if good response, return the name and the arns resolution
      return { name, ...arnsResolution };
    }),
  );

  return resolvedNames.filter((r) => r !== null);
}

main()
  .then((result) => {
    console.log(result);
  })
  .catch((e) => console.error(e));
