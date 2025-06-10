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

import { randomInt } from './random.js';

describe('randomInt', () => {
  it('should generate a random integer within the specified range', () => {
    const min = 1;
    const max = 10;

    // Run multiple iterations to test randomness
    for (let i = 0; i < 100; i++) {
      const result = randomInt(min, max);

      // Check that the result is an integer
      assert.equal(Math.floor(result), result);

      // Check that the result is within the specified range
      assert.ok(result >= min);
      assert.ok(result < max);
    }
  });

  it('should work with zero as the minimum value', () => {
    const min = 0;
    const max = 5;

    // Run multiple iterations
    for (let i = 0; i < 100; i++) {
      const result = randomInt(min, max);

      assert.ok(result >= min);
      assert.ok(result < max);
    }
  });

  it('should work with negative numbers', () => {
    const min = -10;
    const max = -5;

    // Run multiple iterations
    for (let i = 0; i < 100; i++) {
      const result = randomInt(min, max);

      assert.ok(result >= min);
      assert.ok(result < max);
    }
  });

  it('should work with a range that spans negative to positive', () => {
    const min = -5;
    const max = 5;

    // Run multiple iterations
    for (let i = 0; i < 100; i++) {
      const result = randomInt(min, max);

      assert.ok(result >= min);
      assert.ok(result < max);
    }
  });

  it('should generate all possible values in a small range over many iterations', () => {
    const min = 0;
    const max = 5;
    const possibleValues = new Set();

    // Run many iterations to ensure we get all possible values
    for (let i = 0; i < 1000; i++) {
      possibleValues.add(randomInt(min, max));
    }

    // With many iterations, we should get all possible values
    assert.equal(possibleValues.size, max - min);

    // Check that all values in the range are present
    for (let i = min; i < max; i++) {
      assert.ok(possibleValues.has(i));
    }
  });
});
