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
import { GatewaysProvider } from '../../types/wayfinder.js';

export class StaticGatewaysProvider implements GatewaysProvider {
  private gateways: URL[];
  constructor({ gateways }: { gateways: string[] }) {
    this.gateways = gateways.map((g) => new URL(g));
  }

  async getGateways(_params?: { path?: string; subdomain?: string }): Promise<URL[]> {
    return this.gateways;
  }
}
