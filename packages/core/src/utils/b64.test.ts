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
