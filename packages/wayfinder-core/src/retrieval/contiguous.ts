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

import { defaultLogger } from '../logger.js';
import type { DataRetrievalStrategy, Logger } from '../types.js';

/**
 * Contiguous data retrieval strategy that fetches the entire transaction
 * data in a single streaming request
 */
export class ContiguousDataRetrievalStrategy implements DataRetrievalStrategy {
  private logger: Logger;
  private fetch: typeof globalThis.fetch;

  constructor({
    logger = defaultLogger,
    fetch = globalThis.fetch,
  }: {
    logger?: Logger;
    fetch?: typeof globalThis.fetch;
  } = {}) {
    this.logger = logger;
    this.fetch = fetch;
  }

  async getData({
    requestUrl,
    headers,
  }: {
    requestUrl: URL;
    headers?: Record<string, string>;
  }): Promise<Response> {
    this.logger.debug('Fetching contiguous transaction data', {
      requestUrl: requestUrl.toString(),
    });

    return this.fetch(requestUrl.toString(), {
      method: 'GET',
      headers: {
        ...headers,
        'x-wayfinder-data-retrieval-strategy': 'contiguous',
      },
    });
  }
}
