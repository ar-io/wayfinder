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
import { SolanaNetworkConfig } from './types';

// Last resort fallback gateway - only used when AR.IO network is unreachable
export const FALLBACK_GATEWAY: GatewayWithAddress = {
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

export const GASLESS_ARNS_DNS_EXPIRATION_TIME = 15 * 60 * 1000; // 15 minutes

/**
 * AR.IO Solana devnet program addresses. Mirrors
 * `@ar.io/sdk` DEVNET_PROGRAM_IDS (clusters.ts). The default RPC URL
 * is the public Solana devnet endpoint, which is heavily rate-limited;
 * users hitting limits should switch to the `custom` network preset and
 * supply their own RPC (QuickNode, Helius, etc.).
 */
export const AR_IO_SOLANA_DEVNET: SolanaNetworkConfig = {
  rpcUrl: 'https://api.devnet.solana.com',
  coreProgramId: '8Njx9wPkXiNzDCgjwVsJFRjpAEV34gGW3n8DzX3V23m1',
  garProgramId: '7WsDTrtZBsfKtnP33XkjuqXCY69JE7n4QVYpynqJCFxz',
  arnsProgramId: '6EZNezcg4rc5hnh8HG34vGquT3WpW5xXypzPb24uyEpp',
  antProgramId: 'DbHbRwUD1oAn1mrDSqtWtvwGcNrmhWdD2g8L4xmeQ7NX',
};

/**
 * AR.IO Solana mainnet program addresses. Mirrors
 * `@ar.io/sdk` MAINNET_PROGRAM_IDS (clusters.ts).
 */
export const AR_IO_SOLANA_MAINNET: SolanaNetworkConfig = {
  rpcUrl: 'https://api.mainnet-beta.solana.com',
  coreProgramId: '73YoECm6NKXpVRoe5f1Q9BcP5DJGPFUjnFy6AxBE5Nvh',
  garProgramId: '89fNiiwgpFSPHKuqfNUkgYTYjtAJAhyqHjXmgXeppGpf',
  arnsProgramId: '2yCUx5edFvUrkibYaUa2ZXWyx9kuJkS8CwyzsgHPWdZZ',
  antProgramId: '2MWexMHfMhGJwMHv9Qm9YAVCqjUFUJwDJAysW4oCUGk5',
};

/**
 * Preset lookup keyed by `NetworkPreset`. `custom` has no preset value
 * (consumer-supplied at runtime). `mainnet` may be null until deployed.
 */
export const AR_IO_SOLANA_PRESETS: Record<
  'devnet' | 'mainnet',
  SolanaNetworkConfig
> = {
  devnet: AR_IO_SOLANA_DEVNET,
  mainnet: AR_IO_SOLANA_MAINNET,
};
export const TOP_ONCHAIN_GATEWAY_LIMIT = 25; // The top amount of gateways returned for onchain performance ranking
export const DNS_LOOKUP_API = 'https://dns.google/resolve';
// Legacy routing constants removed - extension now uses simple string values
