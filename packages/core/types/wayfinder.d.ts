/**
 * Copyright (C) 2022-2024 Permanent Data Solutions, Inc.
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
  getGateways(): Promise<URL[]>;
}

export interface RoutingStrategy {
  selectGateway(params: { gateways: URL[] }): Promise<URL>;
}

export interface DataVerificationStrategy {
  verifyData(params: { data: DataStream; txId: string }): Promise<void>;
}

export interface DataDigestProvider {
  getDigest(params: { txId: string }): Promise<{ hash: string; algorithm: string }>;
}

export interface DataRootProvider {
  getDataRoot(params: { txId: string }): Promise<string>;
}
