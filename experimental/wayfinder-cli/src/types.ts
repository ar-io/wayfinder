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

export interface CliConfig {
  routing?: 'random' | 'fastest' | 'balanced' | 'preferred';
  verification?: 'hash' | 'data-root' | 'signature' | 'remote' | 'disabled';
  gateway?: string;
  outputFormat?: 'human' | 'json';
  verbose?: boolean;
  quiet?: boolean;
  progress?: boolean;
  timeout?: number;
  json?: boolean;
}

export interface FetchCommandOptions {
  output?: string;
  routing?: string;
  verify?: string;
  gateway?: string;
  progress?: boolean;
  json?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  timeout?: number;
}

export interface ConfigCommandOptions {
  global?: boolean;
}

export interface InfoCommandOptions {
  json?: boolean;
  limit?: number;
}

export interface OutputMetadata {
  uri: string;
  txId: string;
  gateway: string;
  contentLength?: number;
  contentType?: string;
  verificationStatus?: 'verified' | 'failed' | 'skipped';
  duration: number;
  bytesReceived: number;
}
