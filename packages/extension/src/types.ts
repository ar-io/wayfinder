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
import { AoGatewayWithAddress } from '@ar.io/sdk';

export type RedirectedTabInfo = {
  originalGateway: string; // The original gateway FQDN (e.g., "permagate.io")
  expectedSandboxRedirect: boolean; // Whether we expect a sandbox redirect
  sandboxRedirectUrl?: string; // The final redirected URL (if applicable)
  startTime: number; // Timestamp of when the request started
  arUrl?: string; // Original ar:// URL that was processed
};

export type GatewayRegistry = Record<string, AoGatewayWithAddress>;
