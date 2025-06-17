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
export async function fetchEnsArweaveTxId(
  ensName: string,
): Promise<string | null> {
  try {
    const response = await fetch(`https://api.ensdata.net/${ensName}`);
    if (!response.ok) throw new Error(`ENS API error: ${response.statusText}`);

    const data = await response.json();
    return data['ar://'] || data['contentHash'] || null; // Return the Arweave TX ID or content hash if available
  } catch (error) {
    console.error(`[ERROR] Failed to fetch ENS data for ${ensName}:`, error);
    return null;
  }
}
