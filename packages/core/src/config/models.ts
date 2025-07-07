/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Gemini models (for Google auth types)
export const DEFAULT_AGENT_MODEL = 'agent-2.5-pro';
export const DEFAULT_AGENT_FLASH_MODEL = 'agent-2.5-flash';
export const DEFAULT_AGENT_EMBEDDING_MODEL = 'agent-embedding-001';

// OpenAI models
export const DEFAULT_OPENAI_MODEL = 'gpt-4o';
export const DEFAULT_OPENAI_FAST_MODEL = 'gpt-4o-mini';
export const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-ada-002';

// Default models for custom APIs (OpenAI-compatible)
export const DEFAULT_CUSTOM_MODEL = 'gpt-4o';
export const DEFAULT_CUSTOM_FAST_MODEL = 'gpt-4o-mini';
export const DEFAULT_CUSTOM_EMBEDDING_MODEL = 'text-embedding-ada-002';

/**
 * Get the appropriate default model based on auth type
 */
export function getDefaultModelForAuthType(authType: string): string {
  switch (authType) {
    case 'openai-api-key':
      return DEFAULT_OPENAI_MODEL;
    case 'custom-api-key':
      return DEFAULT_CUSTOM_MODEL;
    case 'agent-api-key':
    case 'oauth-personal':
    case 'vertex-ai':
    default:
      return DEFAULT_AGENT_MODEL;
  }
}

/**
 * Get the appropriate fast/flash model based on auth type
 */
export function getFastModelForAuthType(authType: string): string {
  switch (authType) {
    case 'openai-api-key':
      return DEFAULT_OPENAI_FAST_MODEL;
    case 'custom-api-key':
      return DEFAULT_CUSTOM_FAST_MODEL;
    case 'agent-api-key':
    case 'oauth-personal':
    case 'vertex-ai':
    default:
      return DEFAULT_AGENT_FLASH_MODEL;
  }
}

/**
 * Get the appropriate embedding model based on auth type
 */
export function getEmbeddingModelForAuthType(authType: string): string {
  switch (authType) {
    case 'openai-api-key':
      return DEFAULT_OPENAI_EMBEDDING_MODEL;
    case 'custom-api-key':
      return DEFAULT_CUSTOM_EMBEDDING_MODEL;
    case 'agent-api-key':
    case 'oauth-personal':
    case 'vertex-ai':
    default:
      return DEFAULT_AGENT_EMBEDDING_MODEL;
  }
}
