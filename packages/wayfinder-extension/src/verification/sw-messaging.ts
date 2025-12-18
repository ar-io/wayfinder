/**
 * WayFinder Extension - Service Worker Messaging
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc.
 *
 * Licensed under the Apache License, Version 2.0
 *
 * Helper for communicating with the verification service worker.
 */

import type { SwWayfinderConfig, VerificationEvent } from './types';

export interface ServiceWorkerMessage {
  type: string;
  [key: string]: unknown;
}

export class VerificationSwMessenger {
  private listeners = new Map<
    string,
    Set<(event: VerificationEvent) => void>
  >();
  private messageListenerAttached = false;
  private registrationPromise: Promise<ServiceWorkerRegistration> | null = null;
  private registration: ServiceWorkerRegistration | null = null;

  /**
   * Register the verification service worker.
   * Safe to call multiple times - will reuse existing registration.
   *
   * @param scriptURL - URL to the service worker script
   * @param options - Registration options
   */
  async register(
    scriptURL: string,
    options?: RegistrationOptions,
  ): Promise<ServiceWorkerRegistration> {
    // Reuse existing registration if in progress
    if (this.registrationPromise) {
      return this.registrationPromise;
    }

    this.registrationPromise = this.doRegister(scriptURL, options);
    return this.registrationPromise;
  }

  private async doRegister(
    scriptURL: string,
    options?: RegistrationOptions,
  ): Promise<ServiceWorkerRegistration> {
    if (!('serviceWorker' in navigator)) {
      throw new Error('Service workers not supported');
    }

    try {
      console.log('[VerificationSW] Registering service worker:', scriptURL);
      const registration = await navigator.serviceWorker.register(
        scriptURL,
        options,
      );
      this.registration = registration;
      console.log('[VerificationSW] Registered:', registration.scope);

      // Set up message listener (only once)
      if (!this.messageListenerAttached) {
        navigator.serviceWorker.addEventListener('message', (event) => {
          this.handleMessage(event.data);
        });
        this.messageListenerAttached = true;
      }

      // Wait for service worker to be ready
      console.log('[VerificationSW] Waiting for service worker ready...');
      await navigator.serviceWorker.ready;
      console.log('[VerificationSW] Service worker ready');

      // Wait for controller with robust retry
      const hasController = await this.waitForController();

      // On first install, the page may need to reload to be controlled
      // But we can still communicate with the service worker via the registration
      if (!hasController) {
        console.log(
          '[VerificationSW] First install - controller will be available after reload',
        );
        // Don't throw - we'll use the registration's active worker instead
      }

      return registration;
    } catch (error) {
      console.error('[VerificationSW] Registration failed:', error);
      this.registrationPromise = null;
      this.registration = null;
      throw error;
    }
  }

  /**
   * Wait for the service worker to become the controller.
   * Uses exponential backoff with a maximum wait time.
   */
  private async waitForController(maxWaitMs = 5000): Promise<boolean> {
    if (navigator.serviceWorker.controller) {
      console.log('[VerificationSW] Already have controller');
      return true;
    }

    return new Promise<boolean>((resolve) => {
      let resolved = false;

      // Listen for controller change
      const onControllerChange = () => {
        if (!resolved) {
          resolved = true;
          console.log('[VerificationSW] Controller acquired');
          resolve(true);
        }
      };

      navigator.serviceWorker.addEventListener(
        'controllerchange',
        onControllerChange,
        { once: true },
      );

      // Also poll with exponential backoff as a fallback
      const startTime = Date.now();
      const poll = async () => {
        if (resolved) return;

        if (navigator.serviceWorker.controller) {
          resolved = true;
          console.log('[VerificationSW] Controller acquired (poll)');
          resolve(true);
          return;
        }

        if (Date.now() - startTime >= maxWaitMs) {
          resolved = true;
          console.warn(
            '[VerificationSW] Controller not acquired within timeout',
          );
          resolve(false);
          return;
        }

        // Exponential backoff: 50, 100, 200, 400, 800...
        const elapsed = Date.now() - startTime;
        const delay = Math.min(
          50 * Math.pow(2, Math.floor(elapsed / 500)),
          800,
        );
        setTimeout(poll, delay);
      };

      poll();
    });
  }

  /**
   * Get the active service worker, either from controller or registration.
   * This handles the first-install case where controller isn't set yet.
   */
  private getActiveWorker(): ServiceWorker | null {
    // Prefer controller (fully controlling the page)
    if (navigator.serviceWorker.controller) {
      return navigator.serviceWorker.controller;
    }

    // Fallback to registration's active or waiting worker (first install)
    if (this.registration) {
      return (
        this.registration.active ||
        this.registration.waiting ||
        this.registration.installing
      );
    }

    return null;
  }

  /**
   * Check if service worker is controlling the page.
   */
  isControlling(): boolean {
    return 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;
  }

  /**
   * Send message to service worker.
   * Works even on first install before the controller is set.
   */
  async send(message: ServiceWorkerMessage): Promise<ServiceWorkerMessage> {
    const worker = this.getActiveWorker();
    if (!worker) {
      throw new Error('No service worker available');
    }

    return new Promise((resolve, reject) => {
      const messageChannel = new MessageChannel();

      messageChannel.port1.onmessage = (event) => {
        if (event.data.error) {
          reject(new Error(event.data.error));
        } else {
          resolve(event.data);
        }
      };

      worker.postMessage(message, [messageChannel.port2]);
    });
  }

  /**
   * Listen for verification events.
   */
  on(type: string, callback: (event: VerificationEvent) => void): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }

    this.listeners.get(type)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.get(type)?.delete(callback);
    };
  }

  /**
   * Handle incoming message.
   */
  private handleMessage(data: ServiceWorkerMessage): void {
    if (data.type === 'VERIFICATION_EVENT' && data.event) {
      const event = data.event as VerificationEvent;
      const listeners = this.listeners.get(event.type);
      if (listeners) {
        listeners.forEach((callback) => callback(event));
      }

      // Also notify "all" listeners
      const allListeners = this.listeners.get('*');
      if (allListeners) {
        allListeners.forEach((callback) => callback(event));
      }
    }
  }

  /**
   * Initialize Wayfinder in service worker.
   */
  async initializeWayfinder(config: SwWayfinderConfig): Promise<void> {
    await this.send({
      type: 'INIT_WAYFINDER',
      config,
    });
  }

  /**
   * Clear all caches in service worker.
   */
  async clearCache(): Promise<void> {
    await this.send({
      type: 'CLEAR_CACHE',
    });
  }

  /**
   * Clear verification state and cached resources for a specific identifier.
   * Use this before retrying verification to ensure fresh verification.
   */
  async clearVerification(identifier: string): Promise<void> {
    await this.send({
      type: 'CLEAR_VERIFICATION',
      identifier,
    });
  }
}

// Singleton instance
export const verificationSwMessenger = new VerificationSwMessenger();
