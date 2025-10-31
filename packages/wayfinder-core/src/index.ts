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

// types
export * from './types.js';

// routing strategies
export * from './routing/random.js';
export * from './routing/static.js';
export * from './routing/ping.js';
export * from './routing/round-robin.js';
export * from './routing/preferred-with-fallback.js';
export * from './routing/simple-cache.js';
export * from './routing/composite.js';

// gateways providers
export * from './gateways/network.js';
export * from './gateways/simple-cache.js';
export * from './gateways/static.js';
export * from './gateways/local-storage-cache.js';

// verification strategies
export * from './verification/data-root-verification.js';
export * from './verification/hash-verification.js';
export * from './verification/signature-verification.js';
export * from './verification/remote-verification.js';

// emitter
export * from './emitter.js';

// utility functions
export * from './client.js';

// wayfinder
export { Wayfinder } from './wayfinder.js';
