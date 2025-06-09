/**
 * WayFinder
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc. All Rights Reserved.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
import { GatewaysProvider } from '../../types/wayfinder.js';

export class StaticGatewaysProvider implements GatewaysProvider {
  private gateways: URL[];
  constructor({ gateways }: { gateways: string[] }) {
    this.gateways = gateways.map((g) => new URL(g));
  }

  async getGateways(): Promise<URL[]> {
    return this.gateways;
  }
}
