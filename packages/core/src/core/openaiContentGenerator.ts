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
  private toolCallIdMap: Map<string, string> = new Map(); // Maps function names to tool call IDs

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
        
        let accumulatedContent = '';
        let accumulatedToolCalls: any[] = [];
        
        for await (const chunk of stream as any) {
          const choice = chunk.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta;
          
          // Handle text content
          if (delta?.content) {
            accumulatedContent += delta.content;
            yield self.convertFromOpenAIStreamChunk(chunk);
          }
          
          // Handle tool calls in streaming
          if (delta?.tool_calls) {
            for (const toolCall of delta.tool_calls) {
              const index = toolCall.index || 0;
              
              // Initialize tool call if needed
              if (!accumulatedToolCalls[index]) {
                accumulatedToolCalls[index] = {
                  id: toolCall.id || `call_${index}_${Date.now()}`,
                  type: 'function',
                  function: {
                    name: toolCall.function?.name || '',
                    arguments: toolCall.function?.arguments || '',
                  },
                };
              } else {
                // Accumulate arguments
                if (toolCall.function?.arguments) {
                  accumulatedToolCalls[index].function.arguments += toolCall.function.arguments;
                }
                if (toolCall.function?.name) {
                  accumulatedToolCalls[index].function.name = toolCall.function.name;
                }
              }
            }
          }
          
          // If this is the final chunk, yield tool calls
          if (choice.finish_reason && accumulatedToolCalls.length > 0) {
            const mockResponse = {
              choices: [{
                message: {
                  tool_calls: accumulatedToolCalls,
                },
                finish_reason: choice.finish_reason,
              }],
              usage: chunk.usage,
            };
            yield self.convertFromOpenAIResponse(mockResponse);
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
        // Check if this is a function response
        if (this.isFunctionResponseContent(content)) {
          // Handle function responses
          for (const part of content.parts || []) {
            if ((part as any).functionResponse) {
              const functionResponse = (part as any).functionResponse;
              const functionName = functionResponse.name;
              const toolCallId = this.toolCallIdMap.get(functionName) || `call_${functionName}_${Date.now()}`;
              
              messages.push({
                role: 'tool',
                tool_call_id: toolCallId,
                content: JSON.stringify(functionResponse.response || {}),
              });
            }
          }
        } else {
          // Regular user message
          const textContent = this.extractTextFromParts(content.parts || []);
          if (textContent.trim()) {
            messages.push({
              role: 'user',
              content: textContent,
            });
          }
        }
      } else if (content.role === 'model') {
        const text = this.extractTextFromParts(content.parts || []);
        const functionCalls = this.extractFunctionCallsFromParts(content.parts || []);
        
        if (text && text.trim()) {
          messages.push({
            role: 'assistant',
            content: text,
          });
        }
        
        // Handle function calls
        if (functionCalls.length > 0) {
          const toolCalls = functionCalls.map((fc, index) => {
            const toolCallId = fc.id || `call_${fc.name}_${Date.now()}_${index}`;
            // Store the mapping for later function responses
            this.toolCallIdMap.set(fc.name || 'unknown', toolCallId);
            
            return {
              id: toolCallId,
              type: 'function',
              function: {
                name: fc.name,
                arguments: JSON.stringify(fc.args || {}),
              },
            };
          });
          
          messages.push({
            role: 'assistant',
            content: null,
            tool_calls: toolCalls,
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
    const functionCalls: FunctionCall[] = [];
    
    if (choice.message?.content) {
      parts.push({ text: choice.message.content });
    }

    // Handle tool calls
    if (choice.message?.tool_calls) {
      for (const toolCall of choice.message.tool_calls) {
        // Store the tool call ID mapping
        this.toolCallIdMap.set(toolCall.function.name, toolCall.id);
        
        const functionCall = {
          id: toolCall.id,
          name: toolCall.function.name,
          args: JSON.parse(toolCall.function.arguments || '{}'),
        };
        
        parts.push({
          functionCall,
        } as any);
        
        // Also add to the functionCalls array for compatibility
        functionCalls.push(functionCall);
      }
    }

    // Create response as object literal to allow setting functionCalls
    const genResponse: GenerateContentResponse = {
      candidates: [
        {
          content: {
            role: 'model',
            parts,
          },
          finishReason: this.mapFinishReason(choice.finish_reason) as FinishReason,
        },
      ],
      usageMetadata: {
        promptTokenCount: response.usage?.prompt_tokens || 0,
        candidatesTokenCount: response.usage?.completion_tokens || 0,
        totalTokenCount: response.usage?.total_tokens || 0,
      },
      // Set the functionCalls property for compatibility with existing code
      functionCalls: functionCalls.length > 0 ? functionCalls : undefined,
      // Set other required properties from the interface
      promptFeedback: { safetyRatings: [] },
      text: undefined,
      data: undefined,
      executableCode: undefined,
      codeExecutionResult: undefined,
    };
    
    return genResponse;
  }

  private convertFromOpenAIStreamChunk(chunk: any): GenerateContentResponse {
    const choice = chunk.choices?.[0];
    const content = choice?.delta?.content || '';
    
    // Create response as object literal for consistency
    const genResponse: GenerateContentResponse = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: content ? [{ text: content }] : [],
          },
          finishReason: choice?.finish_reason ? this.mapFinishReason(choice.finish_reason) as FinishReason : undefined,
        },
      ],
      // Set default values for required properties
      promptFeedback: { safetyRatings: [] },
      text: undefined,
      data: undefined,
      functionCalls: undefined,
      executableCode: undefined,
      codeExecutionResult: undefined,
    };
    
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

  private isFunctionResponseContent(content: Content): boolean {
    return (
      content.role === 'user' &&
      !!content.parts &&
      content.parts.every((part) => !!(part as any).functionResponse)
    );
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
