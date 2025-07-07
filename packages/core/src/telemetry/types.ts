/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GenerateContentResponseUsageMetadata } from '@google/genai';
import { Config } from '../config/config.js';
import { CompletedToolCall } from '../core/coreToolScheduler.js';
import { ToolConfirmationOutcome } from '../tools/tools.js';
import { AuthType } from '../core/contentGenerator.js';

export enum ToolCallDecision {
  ACCEPT = 'accept',
  REJECT = 'reject',
  MODIFY = 'modify',
}

export function getDecisionFromOutcome(
  outcome: ToolConfirmationOutcome,
): ToolCallDecision {
  switch (outcome) {
    case ToolConfirmationOutcome.ProceedOnce:
    case ToolConfirmationOutcome.ProceedAlways:
    case ToolConfirmationOutcome.ProceedAlwaysServer:
    case ToolConfirmationOutcome.ProceedAlwaysTool:
      return ToolCallDecision.ACCEPT;
    case ToolConfirmationOutcome.ModifyWithEditor:
      return ToolCallDecision.MODIFY;
    case ToolConfirmationOutcome.Cancel:
    default:
      return ToolCallDecision.REJECT;
  }
}

export class StartSessionEvent {
  'event.name': 'cli_config';
  'event.timestamp': string; // ISO 8601
  model: string;
  embedding_model: string;
  sandbox_enabled: boolean;
  core_tools_enabled: string;
  approval_mode: string;
  api_key_enabled: boolean;
  vertex_ai_enabled: boolean;
  debug_enabled: boolean;
  mcp_servers: string;
  telemetry_enabled: boolean;
  telemetry_log_user_prompts_enabled: boolean;
  file_filtering_respect_git_ignore: boolean;

  constructor(config: Config) {
    const generatorConfig = config.getContentGeneratorConfig();
    const mcpServers = config.getMcpServers();

    let useAgent = false;
    let useVertex = false;
    if (generatorConfig && generatorConfig.authType) {
      useAgent = generatorConfig.authType === AuthType.USE_AGENT;
      useVertex = generatorConfig.authType === AuthType.USE_VERTEX_AI;
    }

    this['event.name'] = 'cli_config';
    this.model = config.getModel();
    this.embedding_model = config.getEmbeddingModel();
    this.sandbox_enabled =
      typeof config.getSandbox() === 'string' || !!config.getSandbox();
    this.core_tools_enabled = (config.getCoreTools() ?? []).join(',');
    this.approval_mode = config.getApprovalMode();
    this.api_key_enabled = useAgent || useVertex;
    this.vertex_ai_enabled = useVertex;
    this.debug_enabled = config.getDebugMode();
    this.mcp_servers = mcpServers ? Object.keys(mcpServers).join(',') : '';
    this.telemetry_enabled = config.getTelemetryEnabled();
    this.telemetry_log_user_prompts_enabled =
      config.getTelemetryLogPromptsEnabled();
    this.file_filtering_respect_git_ignore =
      config.getFileFilteringRespectGitIgnore();
  }
}

export class EndSessionEvent {
  'event.name': 'end_session';
  'event.timestamp': string; // ISO 8601
  session_id?: string;

  constructor(config?: Config) {
    this['event.name'] = 'end_session';
    this['event.timestamp'] = new Date().toISOString();
    this.session_id = config?.getSessionId();
  }
}

export class UserPromptEvent {
  'event.name': 'user_prompt';
  'event.timestamp': string; // ISO 8601
  prompt_length: number;
  prompt?: string;

  constructor(prompt_length: number, prompt?: string) {
    this['event.name'] = 'user_prompt';
    this['event.timestamp'] = new Date().toISOString();
    this.prompt_length = prompt_length;
    this.prompt = prompt;
  }
}

export class ToolCallEvent {
  'event.name': 'tool_call';
  'event.timestamp': string; // ISO 8601
  function_name: string;
  function_args: Record<string, unknown>;
  duration_ms: number;
  success: boolean;
  decision?: ToolCallDecision;
  error?: string;
  error_type?: string;

  constructor(call: CompletedToolCall) {
    this['event.name'] = 'tool_call';
    this['event.timestamp'] = new Date().toISOString();
    this.function_name = call.request.name;
    this.function_args = call.request.args;
    this.duration_ms = call.durationMs ?? 0;
    this.success = call.status === 'success';
    this.decision = call.outcome
      ? getDecisionFromOutcome(call.outcome)
      : undefined;
    this.error = call.response.error?.message;
    this.error_type = call.response.error?.name;
  }
}

export class ApiRequestEvent {
  'event.name': 'api_request';
  'event.timestamp': string; // ISO 8601
  model: string;
  request_text?: string;

  constructor(model: string, request_text?: string) {
    this['event.name'] = 'api_request';
    this['event.timestamp'] = new Date().toISOString();
    this.model = model;
    this.request_text = request_text;
  }
}

export class ApiErrorEvent {
  'event.name': 'api_error';
  'event.timestamp': string; // ISO 8601
  model: string;
  error: string;
  error_type?: string;
  status_code?: number | string;
  duration_ms: number;

  constructor(
    model: string,
    error: string,
    duration_ms: number,
    error_type?: string,
    status_code?: number | string,
  ) {
    this['event.name'] = 'api_error';
    this['event.timestamp'] = new Date().toISOString();
    this.model = model;
    this.error = error;
    this.error_type = error_type;
    this.status_code = status_code;
    this.duration_ms = duration_ms;
  }
}

export class ApiResponseEvent {
  'event.name': 'api_response';
  'event.timestamp': string; // ISO 8601
  model: string;
  status_code?: number | string;
  duration_ms: number;
  error?: string;
  input_token_count: number;
  output_token_count: number;
  cached_content_token_count: number;
  thoughts_token_count: number;
  tool_token_count: number;
  total_token_count: number;
  response_text?: string;

  constructor(
    model: string,
    duration_ms: number,
    usage_data?: GenerateContentResponseUsageMetadata,
    response_text?: string,
    error?: string,
  ) {
    this['event.name'] = 'api_response';
    this['event.timestamp'] = new Date().toISOString();
    this.model = model;
    this.duration_ms = duration_ms;
    this.status_code = 200;
    this.input_token_count = usage_data?.promptTokenCount ?? 0;
    this.output_token_count = usage_data?.candidatesTokenCount ?? 0;
    this.cached_content_token_count = usage_data?.cachedContentTokenCount ?? 0;
    this.thoughts_token_count = usage_data?.thoughtsTokenCount ?? 0;
    this.tool_token_count = usage_data?.toolUsePromptTokenCount ?? 0;
    this.total_token_count = usage_data?.totalTokenCount ?? 0;
    this.response_text = response_text;
    this.error = error;
  }
}

export type TelemetryEvent =
  | StartSessionEvent
  | EndSessionEvent
  | UserPromptEvent
  | ToolCallEvent
  | ApiRequestEvent
  | ApiErrorEvent
  | ApiResponseEvent;
