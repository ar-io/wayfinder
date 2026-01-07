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

import type { Tracer } from '@opentelemetry/api';
import type { WayfinderEmitter } from './emitter.js';

// Types

/**
 * This is an extension of the fetch function that allows for overriding the verification and routing settings for a single request.
 */
/**
 * Extension of RequestInit that includes Wayfinder-specific settings
 */
export type WayfinderRequestInit = RequestInit & {
  verificationSettings?: WayfinderOptions['verificationSettings'];
  routingSettings?: WayfinderOptions['routingSettings'];
};

/**
 * Interface that all WayfinderFetch implementations must provide.
 * This allows for custom fetch behavior like payment handling, caching, etc.
 */
/**
 * This is an extension of the fetch function that allows for overriding the verification and routing settings for a single request.
 */
export type WayfinderFetch = (
  input: URL | RequestInfo,
  init?: WayfinderRequestInit,
) => Promise<Response>;

export type WayfinderEvent = {
  'routing-started': { originalUrl: string };
  'routing-skipped': { originalUrl: string };
  'routing-succeeded': {
    originalUrl: string;
    selectedGateway: string;
    redirectUrl: string;
  };
  'routing-failed': Error;
  'verification-succeeded': { txId: string };
  'verification-failed':
    | Error
    | {
        txId?: string;
        error: Error;
        timestamp?: number;
      };
  'verification-skipped': { originalUrl: string };
  'verification-progress': {
    txId: string;
    processedBytes: number;
    totalBytes: number;
  };
  'verification-warning': {
    txId: string;
    message: string;
    timestamp: number;
  };
};

export type RoutingOption = 'random' | 'fastest' | 'balanced' | 'preferred';

export type VerificationOption = 'hash' | 'data-root' | 'remote' | 'disabled';

export type GatewaySelection =
  | 'best-performance'
  | 'most-tenured'
  | 'highest-staked'
  | 'top-ranked'
  | 'longest-streak';

export type SortBy =
  | 'totalDelegatedStake'
  | 'operatorStake'
  | 'startTimestamp'
  | 'weights.gatewayPerformanceRatio'
  | 'weights.tenureWeight'
  | 'weights.stakeWeight'
  | 'weights.compositeWeight'
  | 'stats.passedConsecutiveEpochs'
  | 'weights.normalizedCompositeWeight';

export type SortOrder = 'asc' | 'desc';

// Interfaces

/**
 * Simple logger interface that Wayfinder will use
 * This allows users to provide their own logger implementation
 */
export interface Logger {
  debug: (message: string, ...args: any[]) => void;
  info: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
}

export interface WayfinderRoutingEventArgs {
  onRoutingStarted?: (payload: WayfinderEvent['routing-started']) => void;
  onRoutingSkipped?: (payload: WayfinderEvent['routing-skipped']) => void;
  onRoutingSucceeded?: (payload: WayfinderEvent['routing-succeeded']) => void;
}

export interface WayfinderVerificationEventArgs {
  onVerificationSucceeded?: (
    payload: WayfinderEvent['verification-succeeded'],
  ) => void;
  onVerificationFailed?: (
    payload: WayfinderEvent['verification-failed'],
  ) => void;
  onVerificationProgress?: (
    payload: WayfinderEvent['verification-progress'],
  ) => void;
}

export interface WayfinderEvents
  extends WayfinderVerificationEventArgs,
    WayfinderRoutingEventArgs {}

export interface WayfinderEventArgs {
  verification?: WayfinderVerificationEventArgs;
  routing?: WayfinderRoutingEventArgs;
  parentEmitter?: WayfinderEmitter;
}

export type WayfinderURL = `ar://${string}`;

export type WayfinderURLParams =
  | {
      originalUrl: string; // e.g. https://arweave.net/<txId>
    }
  | {
      wayfinderUrl: WayfinderURL; // e.g. ar://<txId>
    }
  | {
      txId: string; // e.g. <txId>
    }
  | {
      arnsName: string; // e.g. <arnsName>
    };

/**
 * Configuration options for the Wayfinder
 */
export interface WayfinderOptions {
  /**
   * Logger to use for logging
   * @default defaultLogger (standard console logger)
   */
  logger?: Logger;

  /**
   * Custom fetch implementation to use for making HTTP requests.
   * This allows for custom behavior like payment handling, caching, etc.
   * @default native fetch
   */
  fetch?: typeof globalThis.fetch;

  /**
   * The gateways provider to use for routing requests.
   * @deprecated Use routing strategies with their own gateways providers instead.
   */
  gatewaysProvider?: GatewaysProvider;

  /**
   * The verification settings to use for verifying data
   */
  verificationSettings?: {
    /**
     * Whether verification is enabled. If false, verification will be skipped for all requests. If true, strategy must be provided.
     * @default true
     */
    enabled?: boolean;

    /**
     * The events to use for verification
     */
    events?: WayfinderVerificationEventArgs | undefined;

    /**
     * The verification strategy to use for verifying data
     */
    strategy?: VerificationStrategy | undefined;

    /**
     * Whether verification should be strict (blocking)
     * If true, verification failures will cause requests to fail
     * If false, verification will be performed asynchronously with events emitted
     * @default false
     */
    strict?: boolean;
  };

  /**
   * The routing settings to use for routing requests
   */
  routingSettings?: {
    /**
     * The events to use for routing requests
     */
    events?: WayfinderRoutingEventArgs;

    /**
     * The routing strategy to use for routing requests
     */
    strategy?: RoutingStrategy;
  };

  /**
   * Telemetry configuration used to initialize OpenTelemetry tracing
   */
  telemetrySettings?: TelemetrySettings;

  /**
   * The data retrieval strategy to use for fetching transaction data
   */
  dataRetrievalStrategy?: DataRetrievalStrategy;
}

/**
 * Configuration options that match createWayfinderFetch parameters.
 * This type can be used to create a unified configuration for both
 * createWayfinderClient and createWayfinderFetch.
 */
export type WayfinderFetchOptions = {
  /**
   * Logger to use for logging
   * @default defaultLogger (standard console logger)
   */
  logger?: Logger;

  /**
   * The verification strategy to use for verifying data integrity
   */
  verificationStrategy?: VerificationStrategy;

  /**
   * Whether to enforce strict verification.
   * If true, verification failures will cause requests to fail.
   * If false, verification will be performed asynchronously with events emitted.
   * @default false
   */
  strict?: boolean;

  /**
   * The routing strategy to use for selecting gateways
   * @default RandomRoutingStrategy
   */
  routingStrategy?: RoutingStrategy;

  /**
   * The data retrieval strategy to use for fetching transaction data
   * @default ContiguousDataRetrievalStrategy
   */
  dataRetrievalStrategy?: DataRetrievalStrategy;

  /**
   * Event emitter for wayfinder events
   */
  emitter?: WayfinderEmitter;

  /**
   * OpenTelemetry tracer for distributed tracing
   */
  tracer?: Tracer;

  /**
   * Custom fetch implementation to use for making HTTP requests
   * @default native fetch
   */
  fetch?: typeof globalThis.fetch;

  /**
   * Event handlers for wayfinder events
   */
  events?: WayfinderEvents;
};

export interface TelemetrySettings {
  /** Enable or disable telemetry collection */
  enabled: boolean;
  /** Sampling ratio between 0 and 1 */
  sampleRate?: number;
  /** Honeycomb API key */
  apiKey?: string;
  /** Optional custom OTLP exporter URL */
  exporterUrl?: string;
  /** Client name (e.g. "wayfinder-extension") */
  clientName?: string;
  /** Client version (e.g. "1.0.0") */
  clientVersion?: string;
}

// Interfaces

export type DataStream = ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;

export interface GatewaysProvider {
  getGateways(): Promise<URL[]>;
}

export interface RoutingStrategy {
  name?: string;
  selectGateway(params: {
    gateways?: URL[];
    path?: string;
    subdomain?: string;
  }): Promise<URL>;
}

export interface VerificationStrategy {
  trustedGateways: URL[];
  verifyData(params: {
    data: DataStream;
    headers: Record<string, string>;
    txId: string;
  }): Promise<void>;
}

export interface DataClassifier {
  classify(params: { txId: string }): Promise<'ans104' | 'transaction'>;
}

/**
 * Strategy for retrieving transaction data from gateways
 */
export interface DataRetrievalStrategy {
  /**
   * Fetch transaction data using the strategy's implementation
   */
  getData({
    gateway,
    requestUrl,
    headers,
  }: {
    gateway: URL;
    requestUrl: URL;
    headers?: Record<string, string>;
  }): Promise<Response>;
}

/**
 * Progress events emitted during manifest verification
 */
export type ManifestVerificationProgress =
  | {
      type: 'manifest-detected';
      txId: string;
      totalResources: number;
    }
  | {
      type: 'manifest-parsed';
      txId: string;
      manifest: unknown; // ArweaveManifest type
      totalResources: number;
    }
  | {
      type: 'resource-verifying';
      txId: string;
      resourceTxId: string;
      currentIndex: number;
      totalResources: number;
    }
  | {
      type: 'resource-verified';
      txId: string;
      resourceTxId: string;
      verified: boolean;
      currentIndex: number;
      totalResources: number;
    }
  | {
      type: 'nested-manifest-detected';
      parentTxId: string;
      nestedTxId: string;
      depth: number;
    }
  | {
      type: 'manifest-complete';
      txId: string;
      totalVerified: number;
      totalFailed: number;
      allVerified: boolean;
    };

/**
 * Options for requestWithManifest
 */
export interface ManifestRequestOptions {
  /**
   * Whether to verify nested resources in the manifest
   * @default true
   */
  verifyNested?: boolean;

  /**
   * Maximum depth for nested manifest verification
   * @default 5
   */
  maxDepth?: number;

  /**
   * Maximum concurrent verifications
   * @default 10
   */
  concurrency?: number;

  /**
   * Callback for manifest verification progress
   */
  onProgress?: (event: ManifestVerificationProgress) => void;
}

/**
 * Response from requestWithManifest
 */
export interface ManifestResponse extends Response {
  /**
   * Parsed manifest (if content was a manifest)
   */
  manifest?: unknown; // ArweaveManifest type

  /**
   * Verification results for all resources in the manifest
   */
  verificationResults: Map<string, { verified: boolean; error?: Error }>;

  /**
   * Whether all resources in the manifest were successfully verified
   */
  allVerified: boolean;
}
