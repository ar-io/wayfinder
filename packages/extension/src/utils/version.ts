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

export async function getExtensionVersion(): Promise<string> {
  try {
    // Get manifest data using chrome extension API
    const manifest = await chrome.runtime.getManifest();
    return manifest.version || '0.1.0';
  } catch (error) {
    logger.error('Failed to get extension version:', error);
    return '';
  }
}

export async function setExtensionVersion() {
  try {
    const manifest = await chrome.runtime.getManifest();
    const versionElement = document.getElementById('extensionVersion');
    if (versionElement) {
      versionElement.textContent = `v${manifest.version}`;
    }
  } catch (error) {
    console.error('Failed to set extension version:', error);
  }
}
