import { AoGatewayWithAddress } from "@ar.io/sdk";

export const DEFAULT_GATEWAY: AoGatewayWithAddress = {
  operatorStake: 250000000000,
  settings: {
    allowedDelegates: [],
    allowDelegatedStaking: true,
    autoStake: false,
    delegateRewardShareRatio: 5,
    fqdn: "arweave.net",
    label: "Arweave.net",
    minDelegatedStake: 100000000,
    note: "Arweave ecosystem gateway.",
    port: 443,
    properties: "",
    protocol: "https",
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
  status: "joined",
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
  observerAddress: "",
  services: {
    bundlers: [],
  },
  gatewayAddress: "DEFAULT",
};

export const ARIO_MAINNET_PROCESS_ID =
  "qNvAoz0TgcH7DMg8BCVn8jF32QH5L6T29VjHxhHqqGE";
export const GASLESS_ARNS_DNS_EXPIRATION_TIME = 15 * 60 * 1000; // 15 minutes
export const DEFAULT_AO_CU_URL = "https://cu.ardrive.io";
export const MAX_HISTORY_ITEMS = 20; // How many items are stored in wayfinder history
export const TOP_ONCHAIN_GATEWAY_LIMIT = 25; // The top amount of gateways returned for onchain performance ranking
export const DNS_LOOKUP_API = "https://dns.google/resolve";
export const RANDOM_ROUTE_METHOD = "random";
export const STAKE_RANDOM_ROUTE_METHOD = "stakeRandom";
export const HIGHEST_STAKE_ROUTE_METHOD = "highestStake";
export const RANDOM_TOP_FIVE_STAKED_ROUTE_METHOD = "topFiveStake";
export const WEIGHTED_ONCHAIN_PERFORMANCE_ROUTE_METHOD =
  "weightedOnchainPerformance";
export const OPTIMAL_GATEWAY_ROUTE_METHOD = "optimalGateway";
