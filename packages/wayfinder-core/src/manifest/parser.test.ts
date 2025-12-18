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

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { ArweaveManifest, ManifestParser } from './parser.js';

describe('ManifestParser', () => {
  // Valid 43-character Arweave transaction IDs (base64url format)
  const TX_ID_INDEX = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const TX_ID_APP = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  const TX_ID_STYLE = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
  const TX_ID_LOGO = 'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
  const TX_ID_DIR = 'EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE';
  const TX_ID_FILE = 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF';
  const TX_ID_SAME = 'GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG';
  const TX_ID_DIFF = 'HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH';

  const validManifest: ArweaveManifest = {
    manifest: 'arweave/paths',
    version: '0.1.0',
    index: { path: 'index.html' },
    paths: {
      'index.html': { id: TX_ID_INDEX },
      'app.js': { id: TX_ID_APP },
      'style.css': { id: TX_ID_STYLE },
      'assets/logo.png': { id: TX_ID_LOGO },
    },
  };

  describe('isManifest', () => {
    it('should return true for valid manifest', () => {
      assert.strictEqual(ManifestParser.isManifest(validManifest), true);
    });

    it('should return false for null/undefined', () => {
      assert.strictEqual(ManifestParser.isManifest(null), false);
      assert.strictEqual(ManifestParser.isManifest(undefined), false);
    });

    it('should return false for non-object', () => {
      assert.strictEqual(ManifestParser.isManifest('string'), false);
      assert.strictEqual(ManifestParser.isManifest(123), false);
      assert.strictEqual(ManifestParser.isManifest(true), false);
    });

    it('should return false for missing manifest field', () => {
      const invalid = { ...validManifest, manifest: undefined };
      assert.strictEqual(ManifestParser.isManifest(invalid), false);
    });

    it('should return false for wrong manifest type', () => {
      const invalid = { ...validManifest, manifest: 'other/type' };
      assert.strictEqual(ManifestParser.isManifest(invalid), false);
    });

    it('should return false for missing version', () => {
      const invalid = { ...validManifest, version: undefined };
      assert.strictEqual(ManifestParser.isManifest(invalid), false);
    });

    it('should return false for missing paths', () => {
      const invalid = { ...validManifest, paths: undefined };
      assert.strictEqual(ManifestParser.isManifest(invalid), false);
    });

    it('should return false for invalid path entry', () => {
      const invalid = {
        ...validManifest,
        paths: { 'file.txt': { id: '' } }, // empty id
      };
      assert.strictEqual(ManifestParser.isManifest(invalid), false);
    });

    it('should return false for path entry without id', () => {
      const invalid = {
        ...validManifest,
        paths: { 'file.txt': {} },
      };
      assert.strictEqual(ManifestParser.isManifest(invalid), false);
    });
  });

  describe('parse', () => {
    it('should parse valid JSON string', () => {
      const json = JSON.stringify(validManifest);
      const parsed = ManifestParser.parse(json);
      assert.deepStrictEqual(parsed, validManifest);
    });

    it('should parse valid object', () => {
      const parsed = ManifestParser.parse(validManifest);
      assert.deepStrictEqual(parsed, validManifest);
    });

    it('should throw on invalid JSON string', () => {
      assert.throws(
        () => ManifestParser.parse('invalid json'),
        /Invalid manifest JSON/,
      );
    });

    it('should throw on invalid manifest structure', () => {
      const invalid = { manifest: 'wrong', version: '1.0', paths: {} };
      assert.throws(
        () => ManifestParser.parse(invalid),
        /Invalid manifest structure/,
      );
    });
  });

  describe('getAllTransactionIds', () => {
    it('should return all unique transaction IDs', () => {
      const ids = ManifestParser.getAllTransactionIds(validManifest);
      assert.strictEqual(ids.length, 4);
      assert.ok(ids.includes(TX_ID_INDEX));
      assert.ok(ids.includes(TX_ID_APP));
      assert.ok(ids.includes(TX_ID_STYLE));
      assert.ok(ids.includes(TX_ID_LOGO));
    });

    it('should remove duplicate IDs', () => {
      const manifestWithDupes: ArweaveManifest = {
        manifest: 'arweave/paths',
        version: '0.1.0',
        paths: {
          'file1.txt': { id: TX_ID_SAME },
          'file2.txt': { id: TX_ID_SAME },
          'file3.txt': { id: TX_ID_DIFF },
        },
      };
      const ids = ManifestParser.getAllTransactionIds(manifestWithDupes);
      assert.strictEqual(ids.length, 2);
      assert.ok(ids.includes(TX_ID_SAME));
      assert.ok(ids.includes(TX_ID_DIFF));
    });

    it('should return empty array for empty paths', () => {
      const emptyManifest: ArweaveManifest = {
        manifest: 'arweave/paths',
        version: '0.1.0',
        paths: {},
      };
      const ids = ManifestParser.getAllTransactionIds(emptyManifest);
      assert.strictEqual(ids.length, 0);
    });

    it('should throw error for invalid transaction ID format', () => {
      const invalidManifest: ArweaveManifest = {
        manifest: 'arweave/paths',
        version: '0.1.0',
        paths: {
          'file.txt': { id: 'invalid-tx-id' }, // Not 43 characters
        },
      };
      assert.throws(
        () => ManifestParser.getAllTransactionIds(invalidManifest),
        /Invalid transaction ID format/,
      );
    });
  });

  describe('resolvePath', () => {
    it('should resolve exact path match', () => {
      const id = ManifestParser.resolvePath(validManifest, 'app.js');
      assert.strictEqual(id, TX_ID_APP);
    });

    it('should resolve path with leading slash', () => {
      const id = ManifestParser.resolvePath(validManifest, '/app.js');
      assert.strictEqual(id, TX_ID_APP);
    });

    it('should resolve path with trailing slash', () => {
      const manifest: ArweaveManifest = {
        manifest: 'arweave/paths',
        version: '0.1.0',
        paths: {
          dir: { id: TX_ID_DIR },
        },
      };
      const id = ManifestParser.resolvePath(manifest, 'dir/');
      assert.strictEqual(id, TX_ID_DIR);
    });

    it('should resolve nested path', () => {
      const id = ManifestParser.resolvePath(validManifest, 'assets/logo.png');
      assert.strictEqual(id, TX_ID_LOGO);
    });

    it('should resolve empty path to index', () => {
      const id = ManifestParser.resolvePath(validManifest, '');
      assert.strictEqual(id, TX_ID_INDEX);
    });

    it('should resolve root path to index', () => {
      const id = ManifestParser.resolvePath(validManifest, '/');
      assert.strictEqual(id, TX_ID_INDEX);
    });

    it('should return null for non-existent path', () => {
      const id = ManifestParser.resolvePath(validManifest, 'nonexistent.txt');
      assert.strictEqual(id, null);
    });

    it('should return null for empty path when no index', () => {
      const noIndexManifest: ArweaveManifest = {
        manifest: 'arweave/paths',
        version: '0.1.0',
        paths: {
          'file.txt': { id: TX_ID_FILE },
        },
      };
      const id = ManifestParser.resolvePath(noIndexManifest, '');
      assert.strictEqual(id, null);
    });
  });

  describe('getIndex', () => {
    it('should return index transaction ID', () => {
      const id = ManifestParser.getIndex(validManifest);
      assert.strictEqual(id, TX_ID_INDEX);
    });

    it('should return null when no index defined', () => {
      const noIndexManifest: ArweaveManifest = {
        manifest: 'arweave/paths',
        version: '0.1.0',
        paths: {
          'file.txt': { id: TX_ID_FILE },
        },
      };
      const id = ManifestParser.getIndex(noIndexManifest);
      assert.strictEqual(id, null);
    });
  });

  describe('hasPath', () => {
    it('should return true for existing path', () => {
      assert.strictEqual(ManifestParser.hasPath(validManifest, 'app.js'), true);
    });

    it('should return false for non-existing path', () => {
      assert.strictEqual(
        ManifestParser.hasPath(validManifest, 'missing.txt'),
        false,
      );
    });

    it('should handle path normalization', () => {
      assert.strictEqual(
        ManifestParser.hasPath(validManifest, '/app.js'),
        true,
      );
    });
  });

  describe('getAllPaths', () => {
    it('should return all path keys', () => {
      const paths = ManifestParser.getAllPaths(validManifest);
      assert.strictEqual(paths.length, 4);
      assert.ok(paths.includes('index.html'));
      assert.ok(paths.includes('app.js'));
      assert.ok(paths.includes('style.css'));
      assert.ok(paths.includes('assets/logo.png'));
    });

    it('should return empty array for empty manifest', () => {
      const emptyManifest: ArweaveManifest = {
        manifest: 'arweave/paths',
        version: '0.1.0',
        paths: {},
      };
      const paths = ManifestParser.getAllPaths(emptyManifest);
      assert.strictEqual(paths.length, 0);
    });
  });
});
