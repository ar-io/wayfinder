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

// routing strategies
export * from './routing/random.js';
export * from './routing/static.js';
export * from './routing/ping.js';
export * from './routing/round-robin.js';
export * from './routing/preferred-with-fallback.js';

// gateways providers
export * from './gateways/network.js';
export * from './gateways/simple-cache.js';
export * from './gateways/static.js';

// verification strategies
export * from './verification/data-root-verifier.js';
export * from './verification/hash-verifier.js';
export * from './verification/signature-verifier.js';

// wayfinder 
// TODO: consider exporting just Wayfinder and move all the types to the types folder
export * from './wayfinder.js';
