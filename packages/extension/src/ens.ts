/**
 * Fetch the Arweave TX ID for an ENS name using the ENS API.
 * @param ensName The ENS name (e.g., vilenarios.eth)
 * @returns The Arweave TX ID if found, otherwise null.
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
