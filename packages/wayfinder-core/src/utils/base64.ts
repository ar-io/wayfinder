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

import { createHash } from 'crypto';
import { base32 } from 'rfc4648';

// safely encodes and decodes base64url strings to and from buffers
const BASE64_CHAR_62 = '+';
const BASE64_CHAR_63 = '/';
const BASE64URL_CHAR_62 = '-';
const BASE64URL_CHAR_63 = '_';
const BASE64_PADDING = '=';

function base64urlToBase64(str: string): string {
  const padLength = str.length % 4;
  if (padLength) {
    str += BASE64_PADDING.repeat(4 - padLength);
  }

  return str
    .replaceAll(BASE64URL_CHAR_62, BASE64_CHAR_62)
    .replaceAll(BASE64URL_CHAR_63, BASE64_CHAR_63);
}

export function fromB64Url(str: string): Uint8Array {
  const b64Str = base64urlToBase64(str);
  const binaryStr = atob(b64Str);
  return new Uint8Array([...binaryStr].map((c) => c.charCodeAt(0)));
}

export function toB64Url(bytes: Uint8Array): string {
  const b64Str = btoa(String.fromCharCode(...bytes));
  return base64urlFromBase64(b64Str);
}

function base64urlFromBase64(str: string) {
  return str
    .replaceAll(BASE64_CHAR_62, BASE64URL_CHAR_62)
    .replaceAll(BASE64_CHAR_63, BASE64URL_CHAR_63)
    .replaceAll(BASE64_PADDING, '');
}

export function sha256B64Url(input: Uint8Array): string {
  return toB64Url(new Uint8Array(createHash('sha256').update(input).digest()));
}

export function sandboxFromId(id: string): string {
  return base32.stringify(fromB64Url(id), { pad: false }).toLowerCase();
}
