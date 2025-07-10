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

import { logger } from './logger';

export interface ExtensionError {
  code: string;
  message: string;
  details?: any;
}

export class WayfinderError extends Error {
  code: string;
  details?: any;

  constructor(code: string, message: string, details?: any) {
    super(message);
    this.name = 'WayfinderError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Standardized error handling for async operations
 */
export async function handleAsyncOperation<T>(
  operation: () => Promise<T>,
  context: string,
  fallbackValue?: T,
): Promise<T | undefined> {
  try {
    return await operation();
  } catch (error) {
    logger.error(`Error in ${context}:`, error);

    if (fallbackValue !== undefined) {
      logger.debug(`Using fallback value for ${context}`);
      return fallbackValue;
    }

    return undefined;
  }
}

/**
 * Standardized error response for message handlers
 */
export function createErrorResponse(
  error: any,
  context?: string,
): { error: string } {
  const message = error?.message || 'Unknown error occurred';
  const logMessage = context ? `${context}: ${message}` : message;

  logger.error(logMessage, error);

  return { error: message };
}

/**
 * Standardized success response for message handlers
 */
export function createSuccessResponse<T>(data?: T): {
  success: true;
  data?: T;
} {
  return { success: true, ...(data && { data }) };
}
