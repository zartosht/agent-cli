/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

type Model = string;
type TokenCount = number;

export const DEFAULT_TOKEN_LIMIT = 1_048_576;

export function tokenLimit(model: Model): TokenCount {
  // Add other models as they become relevant or if specified by config
  // Pulled from https://ai.google.dev/agent-api/docs/models
  switch (model) {
    case 'agent-1.5-pro':
      return 2_097_152;
    case 'agent-1.5-flash':
    case 'agent-2.5-pro-preview-05-06':
    case 'agent-2.5-pro-preview-06-05':
    case 'agent-2.5-pro':
    case 'agent-2.5-flash-preview-05-20':
    case 'agent-2.5-flash':
    case 'agent-2.0-flash':
      return 1_048_576;
    case 'agent-2.0-flash-preview-image-generation':
      return 32_000;
    default:
      return DEFAULT_TOKEN_LIMIT;
  }
}
