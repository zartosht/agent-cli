/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const SERVICE_NAME = 'agent-cli';

export const EVENT_USER_PROMPT = 'agent_cli.user_prompt';
export const EVENT_TOOL_CALL = 'agent_cli.tool_call';
export const EVENT_API_REQUEST = 'agent_cli.api_request';
export const EVENT_API_ERROR = 'agent_cli.api_error';
export const EVENT_API_RESPONSE = 'agent_cli.api_response';
export const EVENT_CLI_CONFIG = 'agent_cli.config';

export const METRIC_TOOL_CALL_COUNT = 'agent_cli.tool.call.count';
export const METRIC_TOOL_CALL_LATENCY = 'agent_cli.tool.call.latency';
export const METRIC_API_REQUEST_COUNT = 'agent_cli.api.request.count';
export const METRIC_API_REQUEST_LATENCY = 'agent_cli.api.request.latency';
export const METRIC_TOKEN_USAGE = 'agent_cli.token.usage';
export const METRIC_SESSION_COUNT = 'agent_cli.session.count';
export const METRIC_FILE_OPERATION_COUNT = 'agent_cli.file.operation.count';
