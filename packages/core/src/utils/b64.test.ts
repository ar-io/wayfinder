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
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { fromB64Url, toB64Url } from './base64.js';

describe('b64utils', () => {
  it('should convert various strings to base64url and back', () => {
    const testStrings = [
      'Hello, World!',
      'Test123!@#',
      'Base64URLEncoding',
      'Special_Chars+/',
      '',
      'A',
      '1234567890',
    ];
    for (const str of testStrings) {
      const encoded = toB64Url(new TextEncoder().encode(str));
      const decoded = fromB64Url(encoded);
      assert.deepStrictEqual(
        decoded,
        new TextEncoder().encode(str),
        `Failed for string: ${str}`,
      );
    }
  });
  it('should convert various Uint8Arrays to base64url and back', () => {
    const testBuffers = [
      new TextEncoder().encode('Hello, World!'),
      new TextEncoder().encode('Test123!@#'),
      new TextEncoder().encode('Base64URLEncoding'),
      new TextEncoder().encode('Special_Chars+/'),
      new Uint8Array(0),
      new TextEncoder().encode('A'),
      new TextEncoder().encode('1234567890'),
    ];
    for (const buf of testBuffers) {
      const encoded = toB64Url(buf);
      const decoded = fromB64Url(encoded);
      assert.deepStrictEqual(
        decoded,
        buf,
        `Failed for buffer: ${new TextDecoder().decode(buf)}`,
      );
    }
  });
  it('should handle edge cases for base64url conversion', () => {
    const edgeCases = [
      '',
      'A',
      'AA',
      'AAA',
      '====',
      '===',
      '==',
      '=',
      'A===',
      'AA==',
      'AAA=',
    ];
    for (const testCase of edgeCases) {
      const encoded = toB64Url(new TextEncoder().encode(testCase));
      const decoded = new TextDecoder().decode(fromB64Url(encoded));
      assert.strictEqual(
        decoded,
        testCase,
        `Failed for edge case: ${testCase}`,
      );
    }
  });
});
