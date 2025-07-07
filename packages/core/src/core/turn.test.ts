/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  Turn,
  AgentEventType,
  ServerAgentToolCallRequestEvent,
  ServerAgentErrorEvent,
} from './turn.js';
import { GenerateContentResponse, Part, Content } from '@google/genai';
import { reportError } from '../utils/errorReporting.js';
import { AgentChat } from './agentChat.js';

const mockSendMessageStream = vi.fn();
const mockGetHistory = vi.fn();

vi.mock('@google/genai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@google/genai')>();
  const MockChat = vi.fn().mockImplementation(() => ({
    sendMessageStream: mockSendMessageStream,
    getHistory: mockGetHistory,
  }));
  return {
    ...actual,
    Chat: MockChat,
  };
});

vi.mock('../utils/errorReporting', () => ({
  reportError: vi.fn(),
}));

vi.mock('../utils/generateContentResponseUtilities', () => ({
  getResponseText: (resp: GenerateContentResponse) =>
    resp.candidates?.[0]?.content?.parts?.map((part) => part.text).join('') ||
    undefined,
}));

describe('Turn', () => {
  let turn: Turn;
  // Define a type for the mocked Chat instance for clarity
  type MockedChatInstance = {
    sendMessageStream: typeof mockSendMessageStream;
    getHistory: typeof mockGetHistory;
  };
  let mockChatInstance: MockedChatInstance;

  beforeEach(() => {
    vi.resetAllMocks();
    mockChatInstance = {
      sendMessageStream: mockSendMessageStream,
      getHistory: mockGetHistory,
    };
    turn = new Turn(mockChatInstance as unknown as AgentChat);
    mockGetHistory.mockReturnValue([]);
    mockSendMessageStream.mockResolvedValue((async function* () {})());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize pendingToolCalls and debugResponses', () => {
      expect(turn.pendingToolCalls).toEqual([]);
      expect(turn.getDebugResponses()).toEqual([]);
    });
  });

  describe('run', () => {
    it('should yield content events for text parts', async () => {
      const mockResponseStream = (async function* () {
        yield {
          candidates: [{ content: { parts: [{ text: 'Hello' }] } }],
        } as unknown as GenerateContentResponse;
        yield {
          candidates: [{ content: { parts: [{ text: ' world' }] } }],
        } as unknown as GenerateContentResponse;
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events = [];
      const reqParts: Part[] = [{ text: 'Hi' }];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(mockSendMessageStream).toHaveBeenCalledWith({
        message: reqParts,
        config: { abortSignal: expect.any(AbortSignal) },
      });

      expect(events).toEqual([
        { type: AgentEventType.Content, value: 'Hello' },
        { type: AgentEventType.Content, value: ' world' },
      ]);
      expect(turn.getDebugResponses().length).toBe(2);
    });

    it('should yield tool_call_request events for function calls', async () => {
      const mockResponseStream = (async function* () {
        yield {
          functionCalls: [
            {
              id: 'fc1',
              name: 'tool1',
              args: { arg1: 'val1' },
              isClientInitiated: false,
            },
            { name: 'tool2', args: { arg2: 'val2' }, isClientInitiated: false }, // No ID
          ],
        } as unknown as GenerateContentResponse;
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events = [];
      const reqParts: Part[] = [{ text: 'Use tools' }];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events.length).toBe(2);
      const event1 = events[0] as ServerAgentToolCallRequestEvent;
      expect(event1.type).toBe(AgentEventType.ToolCallRequest);
      expect(event1.value).toEqual(
        expect.objectContaining({
          callId: 'fc1',
          name: 'tool1',
          args: { arg1: 'val1' },
          isClientInitiated: false,
        }),
      );
      expect(turn.pendingToolCalls[0]).toEqual(event1.value);

      const event2 = events[1] as ServerAgentToolCallRequestEvent;
      expect(event2.type).toBe(AgentEventType.ToolCallRequest);
      expect(event2.value).toEqual(
        expect.objectContaining({
          name: 'tool2',
          args: { arg2: 'val2' },
          isClientInitiated: false,
        }),
      );
      expect(event2.value.callId).toEqual(
        expect.stringMatching(/^tool2-\d{13}-\w{10,}$/),
      );
      expect(turn.pendingToolCalls[1]).toEqual(event2.value);
      expect(turn.getDebugResponses().length).toBe(1);
    });

    it('should yield UserCancelled event if signal is aborted', async () => {
      const abortController = new AbortController();
      const mockResponseStream = (async function* () {
        yield {
          candidates: [{ content: { parts: [{ text: 'First part' }] } }],
        } as unknown as GenerateContentResponse;
        abortController.abort();
        yield {
          candidates: [
            {
              content: {
                parts: [{ text: 'Second part - should not be processed' }],
              },
            },
          ],
        } as unknown as GenerateContentResponse;
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events = [];
      const reqParts: Part[] = [{ text: 'Test abort' }];
      for await (const event of turn.run(reqParts, abortController.signal)) {
        events.push(event);
      }
      expect(events).toEqual([
        { type: AgentEventType.Content, value: 'First part' },
        { type: AgentEventType.UserCancelled },
      ]);
      expect(turn.getDebugResponses().length).toBe(1);
    });

    it('should yield Error event and report if sendMessageStream throws', async () => {
      const error = new Error('API Error');
      mockSendMessageStream.mockRejectedValue(error);
      const reqParts: Part[] = [{ text: 'Trigger error' }];
      const historyContent: Content[] = [
        { role: 'model', parts: [{ text: 'Previous history' }] },
      ];
      mockGetHistory.mockReturnValue(historyContent);

      const events = [];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events.length).toBe(1);
      const errorEvent = events[0] as ServerAgentErrorEvent;
      expect(errorEvent.type).toBe(AgentEventType.Error);
      expect(errorEvent.value).toEqual({
        error: { message: 'API Error', status: undefined },
      });
      expect(turn.getDebugResponses().length).toBe(0);
      expect(reportError).toHaveBeenCalledWith(
        error,
        'Error when talking to Agent API',
        [...historyContent, reqParts],
        'Turn.run-sendMessageStream',
      );
    });

    it('should handle function calls with undefined name or args', async () => {
      const mockResponseStream = (async function* () {
        yield {
          functionCalls: [
            { id: 'fc1', name: undefined, args: { arg1: 'val1' } },
            { id: 'fc2', name: 'tool2', args: undefined },
            { id: 'fc3', name: undefined, args: undefined },
          ],
        } as unknown as GenerateContentResponse;
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);
      const events = [];
      const reqParts: Part[] = [{ text: 'Test undefined tool parts' }];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events.length).toBe(3);
      const event1 = events[0] as ServerAgentToolCallRequestEvent;
      expect(event1.type).toBe(AgentEventType.ToolCallRequest);
      expect(event1.value).toEqual(
        expect.objectContaining({
          callId: 'fc1',
          name: 'undefined_tool_name',
          args: { arg1: 'val1' },
          isClientInitiated: false,
        }),
      );
      expect(turn.pendingToolCalls[0]).toEqual(event1.value);

      const event2 = events[1] as ServerAgentToolCallRequestEvent;
      expect(event2.type).toBe(AgentEventType.ToolCallRequest);
      expect(event2.value).toEqual(
        expect.objectContaining({
          callId: 'fc2',
          name: 'tool2',
          args: {},
          isClientInitiated: false,
        }),
      );
      expect(turn.pendingToolCalls[1]).toEqual(event2.value);

      const event3 = events[2] as ServerAgentToolCallRequestEvent;
      expect(event3.type).toBe(AgentEventType.ToolCallRequest);
      expect(event3.value).toEqual(
        expect.objectContaining({
          callId: 'fc3',
          name: 'undefined_tool_name',
          args: {},
          isClientInitiated: false,
        }),
      );
      expect(turn.pendingToolCalls[2]).toEqual(event3.value);
      expect(turn.getDebugResponses().length).toBe(1);
    });
  });

  describe('getDebugResponses', () => {
    it('should return collected debug responses', async () => {
      const resp1 = {
        candidates: [{ content: { parts: [{ text: 'Debug 1' }] } }],
      } as unknown as GenerateContentResponse;
      const resp2 = {
        functionCalls: [{ name: 'debugTool' }],
      } as unknown as GenerateContentResponse;
      const mockResponseStream = (async function* () {
        yield resp1;
        yield resp2;
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);
      const reqParts: Part[] = [{ text: 'Hi' }];
      for await (const _ of turn.run(reqParts, new AbortController().signal)) {
        // consume stream
      }
      expect(turn.getDebugResponses()).toEqual([resp1, resp2]);
    });
  });
});
