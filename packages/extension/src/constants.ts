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

export const DEFAULT_GATEWAY: AoGatewayWithAddress = {
  operatorStake: 250000000000,
  settings: {
    allowedDelegates: [],
    allowDelegatedStaking: true,
    autoStake: false,
    delegateRewardShareRatio: 5,
    fqdn: 'arweave.net',
    label: 'Arweave.net',
    minDelegatedStake: 100000000,
    note: 'Arweave ecosystem gateway.',
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
  gatewayAddress: 'DEFAULT',
};

export const ARIO_MAINNET_PROCESS_ID =
  'qNvAoz0TgcH7DMg8BCVn8jF32QH5L6T29VjHxhHqqGE';
export const GASLESS_ARNS_DNS_EXPIRATION_TIME = 15 * 60 * 1000; // 15 minutes
export const DEFAULT_AO_CU_URL = 'https://cu.ardrive.io';
export const TOP_ONCHAIN_GATEWAY_LIMIT = 25; // The top amount of gateways returned for onchain performance ranking
export const DNS_LOOKUP_API = 'https://dns.google/resolve';
// Legacy routing constants removed - extension now uses simple string values
