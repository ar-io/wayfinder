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

import { createHash } from 'crypto';

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
