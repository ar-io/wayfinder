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
export async function fetchEnsArweaveTxId(
  ensName: string
): Promise<string | null> {
  try {
    const response = await fetch(`https://api.ensdata.net/${ensName}`);
    if (!response.ok) throw new Error(`ENS API error: ${response.statusText}`);

    const data = await response.json();
    return data["ar://"] || data["contentHash"] || null; // Return the Arweave TX ID or content hash if available
  } catch (error) {
    console.error(`❌ Failed to fetch ENS data for ${ensName}:`, error);
    return null;
  }
}
