/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DEFAULT_AGENT_MODEL,
  DEFAULT_AGENT_FLASH_MODEL,
} from '../config/models.js';

/**
 * Checks if the default "pro" model is rate-limited and returns a fallback "flash"
 * model if necessary. This function is designed to be silent.
 * @param apiKey The API key to use for the check.
 * @param currentConfiguredModel The model currently configured in settings.
 * @returns An object indicating the model to use, whether a switch occurred,
 *          and the original model if a switch happened.
 */
export async function getEffectiveModel(
  apiKey: string,
  currentConfiguredModel: string,
): Promise<string> {
  if (currentConfiguredModel !== DEFAULT_AGENT_MODEL) {
    // Only check if the user is trying to use the specific pro model we want to fallback from.
    return currentConfiguredModel;
  }

  const modelToTest = DEFAULT_AGENT_MODEL;
  const fallbackModel = DEFAULT_AGENT_FLASH_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelToTest}:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: 'test' }] }],
    generationConfig: {
      maxOutputTokens: 1,
      temperature: 0,
      topK: 1,
      thinkingConfig: { thinkingBudget: 0, includeThoughts: false },
    },
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000); // 500ms timeout for the request

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 429) {
      console.log(
        `[INFO] Your configured model (${modelToTest}) was temporarily unavailable. Switched to ${fallbackModel} for this session.`,
      );
      return fallbackModel;
    }
    // For any other case (success, other error codes), we stick to the original model.
    return currentConfiguredModel;
  } catch (_error) {
    clearTimeout(timeoutId);
    // On timeout or any other fetch error, stick to the original model.
    return currentConfiguredModel;
  }
}
