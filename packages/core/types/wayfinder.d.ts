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

export type DataStream = ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;

export interface GatewaysProvider {
  getGateways(params?: { path?: string; subdomain?: string }): Promise<URL[]>;
}

export interface RoutingStrategy {
  selectGateway(params: {
    gateways: URL[];
    path?: string;
    subdomain?: string;
  }): Promise<URL>;
}

export interface VerificationStrategy {
  verifyData(params: { data: DataStream; txId: string }): Promise<void>;
}

export interface DataClassifier {
  classify(params: { txId: string }): Promise<'ans104' | 'transaction'>;
}
