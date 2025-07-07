/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CountTokensResponse,
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
  GoogleGenAI,
} from '@google/genai';
import { createCodeAssistContentGenerator } from '../code_assist/codeAssist.js';
import { DEFAULT_AGENT_MODEL } from '../config/models.js';
import { getEffectiveModel } from './modelCheck.js';
import { OpenAIContentGenerator } from './openaiContentGenerator.js';

/**
 * Interface abstracting the core functionalities for generating content and counting tokens.
 */
export interface ContentGenerator {
  generateContent(
    request: GenerateContentParameters,
  ): Promise<GenerateContentResponse>;

  generateContentStream(
    request: GenerateContentParameters,
  ): Promise<AsyncGenerator<GenerateContentResponse>>;

  countTokens(request: CountTokensParameters): Promise<CountTokensResponse>;

  embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse>;
}

export enum AuthType {
  LOGIN_WITH_GOOGLE = 'oauth-personal',
  USE_AGENT = 'agent-api-key',
  USE_VERTEX_AI = 'vertex-ai',
  USE_OPENAI = 'openai-api-key',
  USE_CUSTOM_API = 'custom-api-key',
}

export type ContentGeneratorConfig = {
  model: string;
  apiKey?: string;
  baseURL?: string;
  vertexai?: boolean;
  authType?: AuthType | undefined;
};

export async function createContentGeneratorConfig(
  model: string | undefined,
  authType: AuthType | undefined,
  config?: { getModel?: () => string },
): Promise<ContentGeneratorConfig> {
  const agentApiKey = process.env.AGENT_API_KEY;
  const googleApiKey = process.env.GOOGLE_API_KEY;
  const googleCloudProject = process.env.GOOGLE_CLOUD_PROJECT;
  const googleCloudLocation = process.env.GOOGLE_CLOUD_LOCATION;
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const customApiKey = process.env.CUSTOM_API_KEY;

  // Use runtime model from config if available, otherwise fallback to parameter or default
  const effectiveModel = config?.getModel?.() || model || DEFAULT_AGENT_MODEL;

  const contentGeneratorConfig: ContentGeneratorConfig = {
    model: effectiveModel,
    authType,
  };

  // if we are using google auth nothing else to validate for now
  if (authType === AuthType.LOGIN_WITH_GOOGLE) {
    return contentGeneratorConfig;
  }

  if (authType === AuthType.USE_AGENT && agentApiKey) {
    contentGeneratorConfig.apiKey = agentApiKey;
    contentGeneratorConfig.model = await getEffectiveModel(
      contentGeneratorConfig.apiKey,
      contentGeneratorConfig.model,
      authType,
    );

    return contentGeneratorConfig;
  }

  if (authType === AuthType.USE_OPENAI && openaiApiKey) {
    contentGeneratorConfig.apiKey = openaiApiKey;
    contentGeneratorConfig.model = await getEffectiveModel(
      contentGeneratorConfig.apiKey,
      contentGeneratorConfig.model,
      authType,
    );
    return contentGeneratorConfig;
  }

  if (authType === AuthType.USE_CUSTOM_API && customApiKey) {
    contentGeneratorConfig.apiKey = customApiKey;
    const customApiBaseUrl = process.env.CUSTOM_API_BASE_URL;
    contentGeneratorConfig.baseURL = customApiBaseUrl;
    contentGeneratorConfig.model = await getEffectiveModel(
      contentGeneratorConfig.apiKey,
      contentGeneratorConfig.model,
      authType,
      customApiBaseUrl,
    );
    return contentGeneratorConfig;
  }

  if (
    authType === AuthType.USE_VERTEX_AI &&
    !!googleApiKey &&
    googleCloudProject &&
    googleCloudLocation
  ) {
    contentGeneratorConfig.apiKey = googleApiKey;
    contentGeneratorConfig.vertexai = true;
    contentGeneratorConfig.model = await getEffectiveModel(
      contentGeneratorConfig.apiKey,
      contentGeneratorConfig.model,
      authType,
    );

    return contentGeneratorConfig;
  }

  return contentGeneratorConfig;
}

export async function createContentGenerator(
  config: ContentGeneratorConfig,
  sessionId?: string,
): Promise<ContentGenerator> {
  const version = process.env.CLI_VERSION || process.version;
  const httpOptions = {
    headers: {
      'User-Agent': `AgentCLI/${version} (${process.platform}; ${process.arch})`,
    },
  };
  if (config.authType === AuthType.LOGIN_WITH_GOOGLE) {
    return createCodeAssistContentGenerator(
      httpOptions,
      config.authType,
      sessionId,
    );
  }

  if (
    config.authType === AuthType.USE_AGENT ||
    config.authType === AuthType.USE_VERTEX_AI
  ) {
    const googleGenAI = new GoogleGenAI({
      apiKey: config.apiKey === '' ? undefined : config.apiKey,
      vertexai: config.vertexai,
      httpOptions,
    });

    return googleGenAI.models;
  }

  if (config.authType === AuthType.USE_OPENAI) {
    if (!config.apiKey) {
      throw new Error('OpenAI API key is required');
    }
    
    return new OpenAIContentGenerator({
      apiKey: config.apiKey,
      model: config.model,
    });
  }

  if (config.authType === AuthType.USE_CUSTOM_API) {
    if (!config.apiKey) {
      throw new Error('Custom API key is required');
    }
    
    const baseURL = process.env.CUSTOM_API_BASE_URL;
    if (!baseURL) {
      throw new Error('CUSTOM_API_BASE_URL environment variable is required');
    }
    
    return new OpenAIContentGenerator({
      apiKey: config.apiKey,
      baseURL,
      model: config.model,
    });
  }

  throw new Error(
    `Error creating contentGenerator: Unsupported authType: ${config.authType}`,
  );
}
