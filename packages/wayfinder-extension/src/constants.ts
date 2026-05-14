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
import { AoGatewayWithAddress } from '@ar.io/sdk/web';
import { SolanaNetworkConfig } from './types';

// Last resort fallback gateway - only used when AR.IO network is unreachable
export const FALLBACK_GATEWAY: AoGatewayWithAddress = {
  operatorStake: 0,
  settings: {
    allowedDelegates: [],
    allowDelegatedStaking: false,
    autoStake: false,
    delegateRewardShareRatio: 0,
    fqdn: 'turbo-gateway.com',
    label: 'Turbo Gateway (Fallback)',
    minDelegatedStake: 0,
    note: 'Last resort fallback gateway when AR.IO network is unreachable.',
    port: 443,
    properties: '',
    protocol: 'https',
  },
  stats: {
    failedConsecutiveEpochs: 0,
    passedEpochCount: 0,
    passedConsecutiveEpochs: 0,
    totalEpochCount: 0,
    failedEpochCount: 0,
    observedEpochCount: 0,
    prescribedEpochCount: 0,
  },
  status: 'joined',
  totalDelegatedStake: 0,
  weights: {
    stakeWeight: 0,
    tenureWeight: 0,
    gatewayRewardRatioWeight: 0,
    normalizedCompositeWeight: 0,
    observerRewardRatioWeight: 0,
    compositeWeight: 0,
    gatewayPerformanceRatio: 0,
    observerPerformanceRatio: 0,
  },
  startTimestamp: 0,
  endTimestamp: 0,
  observerAddress: '',
  services: {
    bundlers: [],
  },
  gatewayAddress: 'FALLBACK',
};

export const ARIO_MAINNET_PROCESS_ID =
  'qNvAoz0TgcH7DMg8BCVn8jF32QH5L6T29VjHxhHqqGE';
export const GASLESS_ARNS_DNS_EXPIRATION_TIME = 15 * 60 * 1000; // 15 minutes
export const DEFAULT_AO_CU_URL = 'https://cu.ardrive.io';

/**
 * AR.IO Solana devnet program addresses. Mirrors
 * `ar-io-solana-contracts/program-ids/devnet.json`. The default RPC URL
 * is the public Solana devnet endpoint, which is heavily rate-limited;
 * users hitting limits should switch to the `custom` network preset and
 * supply their own RPC (QuickNode, Helius, etc.).
 */
export const AR_IO_SOLANA_DEVNET: SolanaNetworkConfig = {
  rpcUrl: 'https://api.devnet.solana.com',
  coreProgramId: '83CQLP848zzCgnZ4LTq87g6hvxTooNLX7YXXkUUGv5ig',
  garProgramId: 'AF8QAEaR4hzsqeUDwEdeTXMYtdyFegTENBdnJro6WVLR',
  arnsProgramId: '2HgSCKYjcapJPdHRKqkLrGXm7kvBmCP45ZyhWEm87oM1',
  antProgramId: '8ZMuXhiK7DorjPUg8RB1rzu7CvsABMk38WDJRbM62y2C',
};

/**
 * AR.IO Solana mainnet program addresses. Mainnet is not yet deployed
 * (as of 2026-05); this stays `null` until the AR.IO contracts ship on
 * Solana mainnet. The `mainnet` preset in the settings UI is disabled
 * until this is non-null.
 */
export const AR_IO_SOLANA_MAINNET: SolanaNetworkConfig | null = null;

/**
 * Preset lookup keyed by `NetworkPreset`. `custom` has no preset value
 * (consumer-supplied at runtime). `mainnet` may be null until deployed.
 */
export const AR_IO_SOLANA_PRESETS: Record<
  'devnet' | 'mainnet',
  SolanaNetworkConfig | null
> = {
  devnet: AR_IO_SOLANA_DEVNET,
  mainnet: AR_IO_SOLANA_MAINNET,
};
export const TOP_ONCHAIN_GATEWAY_LIMIT = 25; // The top amount of gateways returned for onchain performance ranking
export const DNS_LOOKUP_API = 'https://dns.google/resolve';
// Legacy routing constants removed - extension now uses simple string values
