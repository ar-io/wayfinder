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

import { txIdRegex } from '../constants.js';

/**
 * Represents an Arweave manifest structure
 * @see https://github.com/ArweaveTeam/arweave/blob/master/doc/path-manifest-schema.md
 */
export interface ArweaveManifest {
  manifest: 'arweave/paths';
  version: string;
  index?: { path: string };
  paths: Record<string, { id: string }>;
}

/**
 * Parser for Arweave manifest files
 *
 * Provides utilities to parse, validate, and work with Arweave manifests.
 * Manifests map file paths to transaction IDs, enabling directory-like structures on Arweave.
 */
export class ManifestParser {
  /**
   * Check if data appears to be a valid Arweave manifest
   *
   * @param data - Unknown data to check
   * @returns true if data looks like a manifest
   */
  static isManifest(data: unknown): boolean {
    if (!data || typeof data !== 'object') {
      return false;
    }

    const obj = data as Record<string, unknown>;

    // Check for required fields
    if (obj.manifest !== 'arweave/paths') {
      return false;
    }

    if (typeof obj.version !== 'string') {
      return false;
    }

    if (!obj.paths || typeof obj.paths !== 'object') {
      return false;
    }

    // Check paths structure
    const paths = obj.paths as Record<string, unknown>;
    for (const value of Object.values(paths)) {
      if (!value || typeof value !== 'object') {
        return false;
      }
      const pathValue = value as Record<string, unknown>;
      if (typeof pathValue.id !== 'string' || !pathValue.id) {
        return false;
      }
    }

    return true;
  }

  /**
   * Parse a manifest from string or object
   *
   * @param data - Manifest data as JSON string or parsed object
   * @returns Parsed and validated manifest
   * @throws Error if manifest is invalid
   */
  static parse(data: string | object): ArweaveManifest {
    let parsed: unknown;

    if (typeof data === 'string') {
      try {
        parsed = JSON.parse(data);
      } catch (error) {
        throw new Error('Invalid manifest JSON', { cause: error });
      }
    } else {
      parsed = data;
    }

    if (!this.isManifest(parsed)) {
      throw new Error('Invalid manifest structure');
    }

    return parsed as ArweaveManifest;
  }

  /**
   * Get all transaction IDs referenced in a manifest
   *
   * This includes all path entries, which may reference either
   * regular transactions or nested manifests.
   *
   * @param manifest - The manifest to extract IDs from
   * @returns Array of unique transaction IDs
   * @throws Error if any transaction ID has an invalid format
   */
  static getAllTransactionIds(manifest: ArweaveManifest): string[] {
    const ids = Object.values(manifest.paths).map((entry) => entry.id);

    // Validate all transaction IDs match Arweave format (43 chars, base64url)
    for (const id of ids) {
      if (!txIdRegex.test(id)) {
        throw new Error(
          `Invalid transaction ID format in manifest: "${id}". ` +
            `Transaction IDs must be exactly 43 characters using base64url alphabet [A-Za-z0-9_-]`,
        );
      }
    }

    return [...new Set(ids)]; // Remove duplicates
  }

  /**
   * Resolve a path to its transaction ID
   *
   * Handles:
   * - Exact path matches
   * - Index path resolution (empty path → index.path)
   * - Path normalization (leading/trailing slashes)
   *
   * @param manifest - The manifest to resolve from
   * @param path - Path to resolve (e.g., "/app.js", "style.css", or "")
   * @returns Transaction ID for the path, or null if not found
   */
  static resolvePath(manifest: ArweaveManifest, path: string): string | null {
    // Normalize path - remove leading/trailing slashes
    let normalizedPath = path.trim();
    if (normalizedPath.startsWith('/')) {
      normalizedPath = normalizedPath.slice(1);
    }
    if (normalizedPath.endsWith('/')) {
      normalizedPath = normalizedPath.slice(0, -1);
    }

    // If empty path and index exists, use index
    if (normalizedPath === '' && manifest.index?.path) {
      normalizedPath = manifest.index.path;
    }

    // Look up in paths
    const entry = manifest.paths[normalizedPath];
    return entry?.id ?? null;
  }

  /**
   * Get the index transaction ID
   *
   * @param manifest - The manifest
   * @returns Index transaction ID, or null if no index defined
   */
  static getIndex(manifest: ArweaveManifest): string | null {
    if (!manifest.index?.path) {
      return null;
    }
    return this.resolvePath(manifest, manifest.index.path);
  }

  /**
   * Check if a path exists in the manifest
   *
   * @param manifest - The manifest
   * @param path - Path to check
   * @returns true if path exists
   */
  static hasPath(manifest: ArweaveManifest, path: string): boolean {
    return this.resolvePath(manifest, path) !== null;
  }

  /**
   * Get all paths in the manifest
   *
   * @param manifest - The manifest
   * @returns Array of all defined paths
   */
  static getAllPaths(manifest: ArweaveManifest): string[] {
    return Object.keys(manifest.paths);
  }
}
