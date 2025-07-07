/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import OpenAI from 'openai';
import {
  GenerateContentResponse,
} from '@google/genai';
import type {
  GenerateContentParameters,
  CountTokensParameters,
  CountTokensResponse,
  EmbedContentParameters,
  EmbedContentResponse,
  Content,
  Part,
  Tool,
  FunctionCall,
  ContentListUnion,
  FinishReason,
} from '@google/genai';
import { ContentGenerator } from './contentGenerator.js';

/**
 * OpenAI-compatible content generator that implements the ContentGenerator interface
 */
export class OpenAIContentGenerator implements ContentGenerator {
  private client: OpenAI;
  private model: string;

  constructor(config: { apiKey: string; baseURL?: string; model: string }) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL || 'https://api.openai.com/v1',
    });
    this.model = config.model;
  }

  async generateContent(
    request: GenerateContentParameters,
  ): Promise<GenerateContentResponse> {
    const openaiRequest = this.convertToOpenAIRequest(request);
    
    try {
      const response = await this.client.chat.completions.create(openaiRequest);
      return this.convertFromOpenAIResponse(response);
    } catch (error) {
      throw new Error(`OpenAI API error: ${error}`);
    }
  }

  async generateContentStream(
    request: GenerateContentParameters,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const openaiRequest = this.convertToOpenAIRequest(request);
    openaiRequest.stream = true;

    const self = this;
    
    return (async function* () {
      try {
        const stream = await self.client.chat.completions.create(openaiRequest);
        
        for await (const chunk of stream as any) {
          if (chunk.choices?.[0]?.delta?.content) {
            yield self.convertFromOpenAIStreamChunk(chunk);
          }
        }
      } catch (error) {
        throw new Error(`OpenAI streaming API error: ${error}`);
      }
    })();
  }

  async countTokens(request: CountTokensParameters): Promise<CountTokensResponse> {
    // OpenAI doesn't have a direct token counting API, so we'll estimate
    // This is a simplified implementation - in a real scenario you might want to use
    // a proper tokenizer library like tiktoken
    const contentArray = this.normalizeContents(request.contents);
    const text = this.extractTextFromContents(contentArray);
    const estimatedTokens = Math.ceil(text.length / 4); // Rough estimation: 1 token ≈ 4 characters
    
    return {
      totalTokens: estimatedTokens,
    };
  }

  async embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse> {
    const contentArray = this.normalizeContents(request.contents);
    const text = this.extractTextFromContents(contentArray);
    
    try {
      const response = await this.client.embeddings.create({
        model: 'text-embedding-ada-002', // Default embedding model
        input: text,
      });

      return {
        embeddings: [{
          values: response.data[0].embedding,
        }],
      };
    } catch (error) {
      throw new Error(`OpenAI embedding API error: ${error}`);
    }
  }

  private normalizeContents(contents: ContentListUnion): Content[] {
    if (Array.isArray(contents)) {
      // Check if it's Content[] or Part[]
      if (contents.length === 0) return [];
      
      const firstItem = contents[0];
      if (typeof firstItem === 'object' && firstItem !== null && 'role' in firstItem) {
        // It's Content[]
        return contents as Content[];
      } else {
        // It's Part[], wrap in a single Content
        return [{
          role: 'user',
          parts: contents as Part[],
        }];
      }
    } else if (typeof contents === 'string') {
      // It's a simple string, wrap in Part and Content
      return [{
        role: 'user',
        parts: [{ text: contents }],
      }];
    } else if (typeof contents === 'object' && contents !== null && 'role' in contents) {
      // It's a single Content
      return [contents as Content];
    } else {
      // It's a single Part
      return [{
        role: 'user',
        parts: [contents as Part],
      }];
    }
  }

  private convertToOpenAIRequest(request: GenerateContentParameters): any {
    const contentArray = this.normalizeContents(request.contents);
    const messages = this.convertContentsToMessages(contentArray);
    
    const openaiRequest: any = {
      model: request.model || this.model,
      messages,
      temperature: request.config?.temperature || 0,
      max_tokens: request.config?.maxOutputTokens,
      top_p: request.config?.topP,
    };

    // Convert tools if present
    if (request.config?.tools && request.config.tools.length > 0) {
      // Handle both Tool[] and mixed ToolListUnion
      const tools = Array.isArray(request.config.tools) ? request.config.tools : [request.config.tools];
      const validTools = tools.filter(tool => tool && typeof tool === 'object' && 'functionDeclarations' in tool);
      if (validTools.length > 0) {
        openaiRequest.tools = this.convertToolsToOpenAI(validTools as Tool[]);
        openaiRequest.tool_choice = 'auto';
      }
    }

    return openaiRequest;
  }

  private convertContentsToMessages(contents: Content[]): any[] {
    const messages: any[] = [];
    
    for (const content of contents) {
      if (content.role === 'user') {
        messages.push({
          role: 'user',
          content: this.extractTextFromParts(content.parts || []),
        });
      } else if (content.role === 'model') {
        const text = this.extractTextFromParts(content.parts || []);
        const functionCalls = this.extractFunctionCallsFromParts(content.parts || []);
        
        if (text) {
          messages.push({
            role: 'assistant',
            content: text,
          });
        }
        
        // Handle function calls
        if (functionCalls.length > 0) {
          messages.push({
            role: 'assistant',
            content: null,
            tool_calls: functionCalls.map((fc, index) => ({
              id: `call_${index}`,
              type: 'function',
              function: {
                name: fc.name,
                arguments: JSON.stringify(fc.args),
              },
            })),
          });
        }
      } else if (content.role === 'function') {
        // Handle function responses
        if (content.parts && content.parts.length > 0) {
          const functionResponse = content.parts[0] as any;
          messages.push({
            role: 'tool',
            tool_call_id: functionResponse.functionCall?.name || 'unknown',
            content: JSON.stringify(functionResponse.functionResponse?.response),
          });
        }
      }
    }
    
    return messages;
  }

  private convertToolsToOpenAI(tools: Tool[]): any[] {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.functionDeclarations?.[0]?.name,
        description: tool.functionDeclarations?.[0]?.description,
        parameters: tool.functionDeclarations?.[0]?.parameters,
      },
    }));
  }

  private convertFromOpenAIResponse(response: any): GenerateContentResponse {
    const choice = response.choices?.[0];
    if (!choice) {
      throw new Error('No choices in OpenAI response');
    }

    const parts: Part[] = [];
    
    if (choice.message?.content) {
      parts.push({ text: choice.message.content });
    }

    // Handle tool calls
    if (choice.message?.tool_calls) {
      for (const toolCall of choice.message.tool_calls) {
        parts.push({
          functionCall: {
            name: toolCall.function.name,
            args: JSON.parse(toolCall.function.arguments || '{}'),
          },
        } as any);
      }
    }

    const genResponse = new GenerateContentResponse();
    genResponse.candidates = [
      {
        content: {
          role: 'model',
          parts,
        },
        finishReason: this.mapFinishReason(choice.finish_reason) as FinishReason,
      },
    ];
    genResponse.usageMetadata = {
      promptTokenCount: response.usage?.prompt_tokens || 0,
      candidatesTokenCount: response.usage?.completion_tokens || 0,
      totalTokenCount: response.usage?.total_tokens || 0,
    };
    
    return genResponse;
  }

  private convertFromOpenAIStreamChunk(chunk: any): GenerateContentResponse {
    const choice = chunk.choices?.[0];
    const content = choice?.delta?.content || '';
    
    const genResponse = new GenerateContentResponse();
    genResponse.candidates = [
      {
        content: {
          role: 'model',
          parts: content ? [{ text: content }] : [],
        },
        finishReason: choice?.finish_reason ? this.mapFinishReason(choice.finish_reason) as FinishReason : undefined,
      },
    ];
    
    return genResponse;
  }

  private extractTextFromContents(contents: Content[]): string {
    return contents
      .map(content => this.extractTextFromParts(content.parts || []))
      .join('\n');
  }

  private extractTextFromParts(parts: Part[]): string {
    return parts
      .filter(part => part.text)
      .map(part => part.text)
      .join('');
  }

  private extractFunctionCallsFromParts(parts: Part[]): FunctionCall[] {
    return parts
      .filter(part => (part as any).functionCall)
      .map(part => (part as any).functionCall);
  }

  private mapFinishReason(reason: string | null): string {
    switch (reason) {
      case 'stop':
        return 'STOP';
      case 'length':
        return 'MAX_TOKENS';
      case 'tool_calls':
        return 'STOP';
      case 'content_filter':
        return 'SAFETY';
      default:
        return 'OTHER';
    }
  }
}
