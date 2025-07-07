/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Buffer } from 'buffer';
import * as https from 'https';
import {
  StartSessionEvent,
  EndSessionEvent,
  UserPromptEvent,
  ToolCallEvent,
  ApiRequestEvent,
  ApiResponseEvent,
  ApiErrorEvent,
} from '../types.js';
import { EventMetadataKey } from './event-metadata-key.js';
import { Config } from '../../config/config.js';
import { getInstallationId } from '../../utils/user_id.js';
import { getGoogleAccountId } from '../../utils/user_id.js';

const start_session_event_name = 'start_session';
const new_prompt_event_name = 'new_prompt';
const tool_call_event_name = 'tool_call';
const api_request_event_name = 'api_request';
const api_response_event_name = 'api_response';
const api_error_event_name = 'api_error';
const end_session_event_name = 'end_session';

export interface LogResponse {
  nextRequestWaitMs?: number;
}

// Singleton class for batch posting log events to Clearcut. When a new event comes in, the elapsed time
// is checked and events are flushed to Clearcut if at least a minute has passed since the last flush.
export class ClearcutLogger {
  private static instance: ClearcutLogger;
  private config?: Config;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Clearcut expects this format.
  private readonly events: any = [];
  private last_flush_time: number = Date.now();
  private flush_interval_ms: number = 1000 * 60; // Wait at least a minute before flushing events.

  private constructor(config?: Config) {
    this.config = config;
  }

  static getInstance(config?: Config): ClearcutLogger | undefined {
    if (config === undefined || !config?.getUsageStatisticsEnabled())
      return undefined;
    if (!ClearcutLogger.instance) {
      ClearcutLogger.instance = new ClearcutLogger(config);
    }
    return ClearcutLogger.instance;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Clearcut expects this format.
  enqueueLogEvent(event: any): void {
    this.events.push([
      {
        event_time_ms: Date.now(),
        source_extension_json: JSON.stringify(event),
      },
    ]);
  }

  createLogEvent(name: string, data: object): object {
    return {
      console_type: 'AGENT_CLI',
      application: 102,
      event_name: name,
      client_install_id: getInstallationId(),
      event_metadata: [data] as object[],
    };
  }

  flushIfNeeded(): void {
    if (Date.now() - this.last_flush_time < this.flush_interval_ms) {
      return;
    }

    // Fire and forget - don't await
    this.flushToClearcut().catch((error) => {
      console.debug('Error flushing to Clearcut:', error);
    });
  }

  async flushToClearcut(): Promise<LogResponse> {
    if (this.config?.getDebugMode()) {
      console.log('Flushing log events to Clearcut.');
    }
    const eventsToSend = [...this.events];
    this.events.length = 0;

    const googleAccountId = await getGoogleAccountId();

    return new Promise<Buffer>((resolve, reject) => {
      const request = [
        {
          log_source_name: 'CONCORD',
          request_time_ms: Date.now(),
          log_event: eventsToSend,
          // Add UserInfo with the raw Gaia ID
          user_info: googleAccountId
            ? {
                UserID: googleAccountId,
              }
            : undefined,
        },
      ];
      const body = JSON.stringify(request);
      const options = {
        hostname: 'play.googleapis.com',
        path: '/log',
        method: 'POST',
        headers: { 'Content-Length': Buffer.byteLength(body) },
      };
      const bufs: Buffer[] = [];
      const req = https.request(options, (res) => {
        res.on('data', (buf) => bufs.push(buf));
        res.on('end', () => {
          resolve(Buffer.concat(bufs));
        });
      });
      req.on('error', (e) => {
        if (this.config?.getDebugMode()) {
          console.log('Clearcut POST request error: ', e);
        }
        // Add the events back to the front of the queue to be retried.
        this.events.unshift(...eventsToSend);
        reject(e);
      });
      req.end(body);
    })
      .then((buf: Buffer) => {
        try {
          this.last_flush_time = Date.now();
          return this.decodeLogResponse(buf) || {};
        } catch (error: unknown) {
          console.error('Error flushing log events:', error);
          return {};
        }
      })
      .catch((error: unknown) => {
        // Handle all errors to prevent unhandled promise rejections
        console.error('Error flushing log events:', error);
        // Return empty response to maintain the Promise<LogResponse> contract
        return {};
      });
  }

  // Visible for testing. Decodes protobuf-encoded response from Clearcut server.
  decodeLogResponse(buf: Buffer): LogResponse | undefined {
    // TODO(obrienowen): return specific errors to facilitate debugging.
    if (buf.length < 1) {
      return undefined;
    }

    // The first byte of the buffer is `field<<3 | type`. We're looking for field
    // 1, with type varint, represented by type=0. If the first byte isn't 8, that
    // means field 1 is missing or the message is corrupted. Either way, we return
    // undefined.
    if (buf.readUInt8(0) !== 8) {
      return undefined;
    }

    let ms = BigInt(0);
    let cont = true;

    // In each byte, the most significant bit is the continuation bit. If it's
    // set, we keep going. The lowest 7 bits, are data bits. They are concatenated
    // in reverse order to form the final number.
    for (let i = 1; cont && i < buf.length; i++) {
      const byte = buf.readUInt8(i);
      ms |= BigInt(byte & 0x7f) << BigInt(7 * (i - 1));
      cont = (byte & 0x80) !== 0;
    }

    if (cont) {
      // We have fallen off the buffer without seeing a terminating byte. The
      // message is corrupted.
      return undefined;
    }

    const returnVal = {
      nextRequestWaitMs: Number(ms),
    };
    return returnVal;
  }

  logStartSessionEvent(event: StartSessionEvent): void {
    const data = [
      {
        agent_cli_key: EventMetadataKey.AGENT_CLI_START_SESSION_MODEL,
        value: event.model,
      },
      {
        agent_cli_key:
          EventMetadataKey.AGENT_CLI_START_SESSION_EMBEDDING_MODEL,
        value: event.embedding_model,
      },
      {
        agent_cli_key: EventMetadataKey.AGENT_CLI_START_SESSION_SANDBOX,
        value: event.sandbox_enabled.toString(),
      },
      {
        agent_cli_key: EventMetadataKey.AGENT_CLI_START_SESSION_CORE_TOOLS,
        value: event.core_tools_enabled,
      },
      {
        agent_cli_key: EventMetadataKey.AGENT_CLI_START_SESSION_APPROVAL_MODE,
        value: event.approval_mode,
      },
      {
        agent_cli_key:
          EventMetadataKey.AGENT_CLI_START_SESSION_API_KEY_ENABLED,
        value: event.api_key_enabled.toString(),
      },
      {
        agent_cli_key:
          EventMetadataKey.AGENT_CLI_START_SESSION_VERTEX_API_ENABLED,
        value: event.vertex_ai_enabled.toString(),
      },
      {
        agent_cli_key:
          EventMetadataKey.AGENT_CLI_START_SESSION_DEBUG_MODE_ENABLED,
        value: event.debug_enabled.toString(),
      },
      {
        agent_cli_key:
          EventMetadataKey.AGENT_CLI_START_SESSION_VERTEX_API_ENABLED,
        value: event.vertex_ai_enabled.toString(),
      },
      {
        agent_cli_key: EventMetadataKey.AGENT_CLI_START_SESSION_MCP_SERVERS,
        value: event.mcp_servers,
      },
      {
        agent_cli_key:
          EventMetadataKey.AGENT_CLI_START_SESSION_VERTEX_API_ENABLED,
        value: event.vertex_ai_enabled.toString(),
      },
      {
        agent_cli_key:
          EventMetadataKey.AGENT_CLI_START_SESSION_TELEMETRY_ENABLED,
        value: event.telemetry_enabled.toString(),
      },
      {
        agent_cli_key:
          EventMetadataKey.AGENT_CLI_START_SESSION_TELEMETRY_LOG_USER_PROMPTS_ENABLED,
        value: event.telemetry_log_user_prompts_enabled.toString(),
      },
    ];
    this.enqueueLogEvent(this.createLogEvent(start_session_event_name, data));
    // Flush start event immediately
    this.flushToClearcut().catch((error) => {
      console.debug('Error flushing start session event to Clearcut:', error);
    });
  }

  logNewPromptEvent(event: UserPromptEvent): void {
    const data = [
      {
        agent_cli_key: EventMetadataKey.AGENT_CLI_USER_PROMPT_LENGTH,
        value: JSON.stringify(event.prompt_length),
      },
    ];

    this.enqueueLogEvent(this.createLogEvent(new_prompt_event_name, data));
    this.flushToClearcut().catch((error) => {
      console.debug('Error flushing to Clearcut:', error);
    });
  }

  logToolCallEvent(event: ToolCallEvent): void {
    const data = [
      {
        agent_cli_key: EventMetadataKey.AGENT_CLI_TOOL_CALL_NAME,
        value: JSON.stringify(event.function_name),
      },
      {
        agent_cli_key: EventMetadataKey.AGENT_CLI_TOOL_CALL_DECISION,
        value: JSON.stringify(event.decision),
      },
      {
        agent_cli_key: EventMetadataKey.AGENT_CLI_TOOL_CALL_SUCCESS,
        value: JSON.stringify(event.success),
      },
      {
        agent_cli_key: EventMetadataKey.AGENT_CLI_TOOL_CALL_DURATION_MS,
        value: JSON.stringify(event.duration_ms),
      },
      {
        agent_cli_key: EventMetadataKey.AGENT_CLI_TOOL_ERROR_MESSAGE,
        value: JSON.stringify(event.error),
      },
      {
        agent_cli_key: EventMetadataKey.AGENT_CLI_TOOL_CALL_ERROR_TYPE,
        value: JSON.stringify(event.error_type),
      },
    ];

    this.enqueueLogEvent(this.createLogEvent(tool_call_event_name, data));
    this.flushToClearcut().catch((error) => {
      console.debug('Error flushing to Clearcut:', error);
    });
  }

  logApiRequestEvent(event: ApiRequestEvent): void {
    const data = [
      {
        agent_cli_key: EventMetadataKey.AGENT_CLI_API_REQUEST_MODEL,
        value: JSON.stringify(event.model),
      },
    ];

    this.enqueueLogEvent(this.createLogEvent(api_request_event_name, data));
    this.flushToClearcut().catch((error) => {
      console.debug('Error flushing to Clearcut:', error);
    });
  }

  logApiResponseEvent(event: ApiResponseEvent): void {
    const data = [
      {
        agent_cli_key: EventMetadataKey.AGENT_CLI_API_RESPONSE_MODEL,
        value: JSON.stringify(event.model),
      },
      {
        agent_cli_key: EventMetadataKey.AGENT_CLI_API_RESPONSE_STATUS_CODE,
        value: JSON.stringify(event.status_code),
      },
      {
        agent_cli_key: EventMetadataKey.AGENT_CLI_API_RESPONSE_DURATION_MS,
        value: JSON.stringify(event.duration_ms),
      },
      {
        agent_cli_key: EventMetadataKey.AGENT_CLI_API_ERROR_MESSAGE,
        value: JSON.stringify(event.error),
      },
      {
        agent_cli_key:
          EventMetadataKey.AGENT_CLI_API_RESPONSE_INPUT_TOKEN_COUNT,
        value: JSON.stringify(event.input_token_count),
      },
      {
        agent_cli_key:
          EventMetadataKey.AGENT_CLI_API_RESPONSE_OUTPUT_TOKEN_COUNT,
        value: JSON.stringify(event.output_token_count),
      },
      {
        agent_cli_key:
          EventMetadataKey.AGENT_CLI_API_RESPONSE_CACHED_TOKEN_COUNT,
        value: JSON.stringify(event.cached_content_token_count),
      },
      {
        agent_cli_key:
          EventMetadataKey.AGENT_CLI_API_RESPONSE_THINKING_TOKEN_COUNT,
        value: JSON.stringify(event.thoughts_token_count),
      },
      {
        agent_cli_key:
          EventMetadataKey.AGENT_CLI_API_RESPONSE_TOOL_TOKEN_COUNT,
        value: JSON.stringify(event.tool_token_count),
      },
    ];

    this.enqueueLogEvent(this.createLogEvent(api_response_event_name, data));
    this.flushToClearcut().catch((error) => {
      console.debug('Error flushing to Clearcut:', error);
    });
  }

  logApiErrorEvent(event: ApiErrorEvent): void {
    const data = [
      {
        agent_cli_key: EventMetadataKey.AGENT_CLI_API_ERROR_MODEL,
        value: JSON.stringify(event.model),
      },
      {
        agent_cli_key: EventMetadataKey.AGENT_CLI_API_ERROR_TYPE,
        value: JSON.stringify(event.error_type),
      },
      {
        agent_cli_key: EventMetadataKey.AGENT_CLI_API_ERROR_STATUS_CODE,
        value: JSON.stringify(event.status_code),
      },
      {
        agent_cli_key: EventMetadataKey.AGENT_CLI_API_ERROR_DURATION_MS,
        value: JSON.stringify(event.duration_ms),
      },
    ];

    this.enqueueLogEvent(this.createLogEvent(api_error_event_name, data));
    this.flushToClearcut().catch((error) => {
      console.debug('Error flushing to Clearcut:', error);
    });
  }

  logEndSessionEvent(event: EndSessionEvent): void {
    const data = [
      {
        agent_cli_key: EventMetadataKey.AGENT_CLI_END_SESSION_ID,
        value: event?.session_id?.toString() ?? '',
      },
    ];

    this.enqueueLogEvent(this.createLogEvent(end_session_event_name, data));
    // Flush immediately on session end.
    this.flushToClearcut().catch((error) => {
      console.debug('Error flushing to Clearcut:', error);
    });
  }

  shutdown() {
    const event = new EndSessionEvent(this.config);
    this.logEndSessionEvent(event);
  }
}
