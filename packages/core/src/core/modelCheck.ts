/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DEFAULT_AGENT_MODEL,
  DEFAULT_AGENT_FLASH_MODEL,
  getDefaultModelForAuthType,
  getFastModelForAuthType,
} from '../config/models.js';
import { AuthType } from './contentGenerator.js';

/**
 * Checks if the configured model is available and returns a fallback model if necessary.
 * This function is designed to be silent and supports different API types.
 * @param apiKey The API key to use for the check.
 * @param currentConfiguredModel The model currently configured.
 * @param authType The authentication type (determines which API to check).
 * @param baseUrl The base URL for custom APIs (optional, used with USE_CUSTOM_API).
 * @returns The model to use (either the original or a fallback).
 */
export async function getEffectiveModel(
  apiKey: string,
  currentConfiguredModel: string,
  authType: AuthType,
  baseUrl?: string,
): Promise<string> {
  const defaultModel = getDefaultModelForAuthType(authType);
  const fallbackModel = getFastModelForAuthType(authType);

  // Only check if the user is trying to use the default model for this auth type
  if (currentConfiguredModel !== defaultModel) {
    return currentConfiguredModel;
  }

  switch (authType) {
    case AuthType.USE_AGENT:
    case AuthType.USE_VERTEX_AI:
      return await checkGeminiModel(apiKey, currentConfiguredModel, fallbackModel);
    
    case AuthType.USE_OPENAI:
      return await checkOpenAIModel(apiKey, currentConfiguredModel, fallbackModel);
    
    case AuthType.USE_CUSTOM_API:
      return await checkCustomAPIModel(apiKey, currentConfiguredModel, fallbackModel, baseUrl);
    
    default:
      // For LOGIN_WITH_GOOGLE or unknown auth types, no checking needed
      return currentConfiguredModel;
  }
}

/**
 * Check if a Gemini model is available (Google API)
 */
async function checkGeminiModel(
  apiKey: string,
  modelToTest: string,
  fallbackModel: string,
): Promise<string> {
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
  const timeoutId = setTimeout(() => controller.abort(), 2000);

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
    return modelToTest;
  } catch (_error) {
    clearTimeout(timeoutId);
    return modelToTest;
  }
}

/**
 * Check if an OpenAI model is available
 */
async function checkOpenAIModel(
  apiKey: string,
  modelToTest: string,
  fallbackModel: string,
): Promise<string> {
  const endpoint = 'https://api.openai.com/v1/chat/completions';
  const body = JSON.stringify({
    model: modelToTest,
    messages: [{ role: 'user', content: 'test' }],
    max_tokens: 1,
    temperature: 0,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
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
    return modelToTest;
  } catch (_error) {
    clearTimeout(timeoutId);
    return modelToTest;
  }
}

/**
 * Check if a custom API model is available (OpenAI-compatible)
 */
async function checkCustomAPIModel(
  apiKey: string,
  modelToTest: string,
  fallbackModel: string,
  baseUrl?: string,
): Promise<string> {
  if (!baseUrl) {
    // If no base URL provided, can't check - return original model
    return modelToTest;
  }

  // Ensure baseUrl ends with /v1 if it doesn't already
  const normalizedBaseUrl = baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl}/v1`;
  const endpoint = `${normalizedBaseUrl}/chat/completions`;
  
  const body = JSON.stringify({
    model: modelToTest,
    messages: [{ role: 'user', content: 'test' }],
    max_tokens: 1,
    temperature: 0,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
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
    return modelToTest;
  } catch (_error) {
    clearTimeout(timeoutId);
    return modelToTest;
  }
}
