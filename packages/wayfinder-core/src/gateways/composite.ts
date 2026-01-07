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
import type { GatewaysProvider, Logger } from '../types.js';

export class CompositeGatewaysProvider implements GatewaysProvider {
  private providers: GatewaysProvider[];
  private logger: Logger;

  constructor({
    providers = [],
    logger = defaultLogger,
  }: {
    providers?: GatewaysProvider[];
    logger?: Logger;
  } = {}) {
    if (providers.length === 0) {
      throw new Error('At least one gateways provider must be provided');
    }
    this.providers = providers;
    this.logger = logger;
  }

  async getGateways(): Promise<URL[]> {
    this.logger.debug('CompositeGatewaysProvider: starting gateway fetch', {
      providersCount: this.providers.length,
    });

    for (const provider of this.providers) {
      try {
        this.logger.debug('CompositeGatewaysProvider: trying provider');
        const gateways = await provider.getGateways();
        if (gateways.length > 0) {
          this.logger.debug('CompositeGatewaysProvider: provider succeeded', {
            gatewaysCount: gateways.length,
          });
          return gateways;
        }
        this.logger.debug(
          'CompositeGatewaysProvider: provider returned empty list',
        );
      } catch (error) {
        this.logger.debug('CompositeGatewaysProvider: provider failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.error(
      'CompositeGatewaysProvider: all providers failed to return gateways',
    );
    throw new Error('All gateways providers failed to return gateways');
  }

  addProvider(provider: GatewaysProvider): void {
    this.providers.push(provider);
  }

  getProviders(): GatewaysProvider[] {
    return [...this.providers];
  }
}
