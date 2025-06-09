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
import {
  DataDigestProvider,
  DataStream,
  DataVerificationStrategy,
} from '../../types/wayfinder.js';
import { hashDataStreamToB64Url } from '../utils/hash.js';

export class HashVerificationStrategy implements DataVerificationStrategy {
  private readonly trustedHashProvider: DataDigestProvider;
  constructor({
    trustedHashProvider,
  }: {
    trustedHashProvider: DataDigestProvider;
  }) {
    this.trustedHashProvider = trustedHashProvider;
  }
  async verifyData({
    data,
    txId,
  }: {
    data: DataStream;
    txId: string;
  }): Promise<void> {
    // kick off the hash computation, but don't wait for it until we compute our own hash
    const [computedHash, fetchedHash] = await Promise.all([
      hashDataStreamToB64Url({ stream: data }),
      this.trustedHashProvider.getDigest({ txId }),
    ]);
    // await on the hash promise and compare to get a little concurrency when computing hashes over larger data
    if (computedHash === undefined) {
      throw new Error('Hash could not be computed');
    }
    if (computedHash !== fetchedHash.hash) {
      throw new Error('Hash does not match', {
        cause: { computedHash, trustedHash: fetchedHash },
      });
    }
  }
}
