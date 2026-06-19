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
import { GatewayWithAddress } from '@ar.io/sdk/web';

export type RedirectedTabInfo = {
  originalGateway: string; // The original gateway FQDN (e.g., "permagate.io")
  expectedSandboxRedirect: boolean; // Whether we expect a sandbox redirect
  sandboxRedirectUrl?: string; // The final redirected URL (if applicable)
  startTime: number; // Timestamp of when the request started
  arUrl?: string; // Original ar:// URL that was processed
  verification?: {
    enabled: boolean;
    expectedDigest?: string;
    txId?: string;
    strategy?: string;
  };
};

export type GatewayRegistry = Record<string, GatewayWithAddress>;

/**
 * Identifier for an AR.IO Solana network deployment. `mainnet` is reserved
 * for the eventual AR.IO Solana mainnet deployment (not yet live as of
 * 2026-05); `devnet` targets the currently-live AR.IO devnet contracts;
 * `custom` lets advanced users plug in their own RPC + program IDs (e.g.,
 * for localnet development).
 */
export type NetworkPreset = 'mainnet' | 'devnet' | 'custom';

/**
 * Solana endpoint + AR.IO program addresses for a single network. All
 * program IDs are base58-encoded Solana pubkeys.
 */
export type SolanaNetworkConfig = {
  rpcUrl: string;
  coreProgramId: string;
  garProgramId: string;
  arnsProgramId: string;
  antProgramId: string;
};

export type VerificationCacheEntry = {
  txId: string;
  verified: boolean;
  timestamp: number;
  gateway: string;
  url: string;
};

export type VerificationMessage = {
  type: 'showVerificationToast';
  verified: boolean;
  gatewayFQDN: string;
  resolvedId?: string;
};
