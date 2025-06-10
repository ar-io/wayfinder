/**
 * WayFinder
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc. All Rights Reserved.
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
import { AoGatewayWithAddress } from '@ar.io/sdk';

export type RedirectedTabInfo = {
  originalGateway: string; // The original gateway FQDN (e.g., "permagate.io")
  expectedSandboxRedirect: boolean; // Whether we expect a sandbox redirect
  sandboxRedirectUrl?: string; // The final redirected URL (if applicable)
  startTime: number; // Timestamp of when the request started
};

export type GatewayRegistry = Record<string, AoGatewayWithAddress>;
