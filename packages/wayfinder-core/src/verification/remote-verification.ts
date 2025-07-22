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
import { DataStream, VerificationStrategy } from '../types.js';
/**
 * This strategy is used to verify data by checking the 'x-ar-io-verified' header from the original response.
 * It does not require any client side computation, but it does require the gateway to set the header.
 *
 * This should be considered mostly unsafe, as gateways could maliciously set the header to true,
 * but it is useful for testing and development.
 */
export class RemoteVerificationStrategy implements VerificationStrategy {
  trustedGateways: URL[] = []; // no trusted gateways for remote verification, we just check the headers of the gateway that returned the data

  async verifyData(params: {
    headers: Record<string, string>;
    txId?: string;
    data?: DataStream;
  }) {
    // make sure headers are all lowercase
    const headers = Object.fromEntries(
      Object.entries(params.headers).map(([key, value]) => [
        key.toLowerCase().trim(),
        value.trim(),
      ]),
    );

    // we don't use the data at all, just the headers
    const remoteVerified = headers['x-ar-io-verified'] === 'true';
    if (!remoteVerified) {
      throw new Error(`Data was not verified by gateway.`);
    }
  }
}
