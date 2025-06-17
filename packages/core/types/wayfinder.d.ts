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
