/**
 * AR.IO Gateway
 * Copyright (C) 2022-2023 Permanent Data Solutions, Inc. All Rights Reserved.
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
