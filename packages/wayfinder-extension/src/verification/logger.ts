/**
 * WayFinder Extension - Verification Logger
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc.
 *
 * Licensed under the Apache License, Version 2.0
 */

/**
 * Simple logger for service worker with log levels.
 *
 * Log levels:
 * - ERROR: Always shown - failures that prevent operation
 * - WARN: Always shown - issues that don't block but should be noted
 * - INFO: Key state changes - shown by default
 * - DEBUG: Verbose logs - hidden by default, enable for troubleshooting
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Default to 'info' - shows info, warn, error. Set to 'debug' for verbose.
let currentLevel: LogLevel = 'info';

const levels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel): boolean {
  return levels[level] >= levels[currentLevel];
}

function formatPrefix(tag: string): string {
  return `[SW:${tag}]`;
}

export const logger = {
  /**
   * Set the log level. 'debug' shows all, 'error' shows only errors.
   */
  setLevel(level: LogLevel): void {
    currentLevel = level;
    console.log(`[SW:Logger] Level set to: ${level}`);
  },

  /**
   * Get the current log level.
   */
  getLevel(): LogLevel {
    return currentLevel;
  },

  /**
   * Debug logs - verbose, hidden by default.
   * Use for: request details, cache hits, step-by-step flow
   */
  debug(tag: string, message: string, data?: unknown): void {
    if (shouldLog('debug')) {
      if (data !== undefined) {
        console.log(formatPrefix(tag), message, data);
      } else {
        console.log(formatPrefix(tag), message);
      }
    }
  },

  /**
   * Info logs - key state changes, shown by default.
   * Use for: verification started/complete, important milestones
   */
  info(tag: string, message: string, data?: unknown): void {
    if (shouldLog('info')) {
      if (data !== undefined) {
        console.log(formatPrefix(tag), message, data);
      } else {
        console.log(formatPrefix(tag), message);
      }
    }
  },

  /**
   * Warning logs - always shown.
   * Use for: fallbacks, retries, non-critical issues
   */
  warn(tag: string, message: string, data?: unknown): void {
    if (shouldLog('warn')) {
      if (data !== undefined) {
        console.warn(formatPrefix(tag), message, data);
      } else {
        console.warn(formatPrefix(tag), message);
      }
    }
  },

  /**
   * Error logs - always shown.
   * Use for: failures, exceptions, blocking issues
   */
  error(tag: string, message: string, data?: unknown): void {
    if (shouldLog('error')) {
      if (data !== undefined) {
        console.error(formatPrefix(tag), message, data);
      } else {
        console.error(formatPrefix(tag), message);
      }
    }
  },
};
