/**
 * WayFinder Error Handling Utilities
 * Standardized error handling for the extension
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
