/**
 * Agent loop - orchestrates LLM and tool execution
 */

import type { Message, ToolCall, OllamaStreamChunk } from "../llm/client.ts";
import { client } from "../llm/client.ts";
import { SYSTEM_PROMPT, tools } from "../llm/prompts.ts";
import { executeTool, formatToolCall } from "../tools/index.ts";

const MAX_ITERATIONS = 10;

export interface AgentCallbacks {
  onThinking: () => void;
  onToken: (token: string) => void;
  onToolCall: (name: string, args: string) => void;
  onToolResult: (name: string, result: string, success: boolean) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
}

export async function runAgent(
  userMessage: string,
  history: Message[],
  callbacks: AgentCallbacks
): Promise<Message[]> {
  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: userMessage },
  ];

  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    callbacks.onThinking();

    try {
      const { content, toolCalls } = await streamResponse(messages, callbacks);

      // Add assistant message to history
      const assistantMessage: Message = {
        role: "assistant",
        content: content || "",
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      };
      messages.push(assistantMessage);

      // If no tool calls, we're done
      if (toolCalls.length === 0) {
        callbacks.onComplete();
        break;
      }

      // Execute tool calls
      for (const toolCall of toolCalls) {
        const argsJson = JSON.stringify(toolCall.function.arguments);
        callbacks.onToolCall(toolCall.function.name, argsJson);

        const result = await executeTool(toolCall.function.name, argsJson);

        callbacks.onToolResult(
          toolCall.function.name,
          result.output,
          result.success
        );

        // Add tool result to messages
        messages.push({
          role: "tool",
          content: result.output,
          tool_call_id: toolCall.id,
        });
      }

      // Continue the loop to get the next response
    } catch (error) {
      callbacks.onError(
        error instanceof Error ? error : new Error(String(error))
      );
      break;
    }
  }

  if (iterations >= MAX_ITERATIONS) {
    callbacks.onError(new Error("Max iterations reached"));
  }

  // Return updated history (excluding system prompt)
  return messages.slice(1);
}

const DEBUG = process.env.DEBUG === "1";
const USE_STREAMING = process.env.NO_STREAM !== "1";

async function streamResponse(
  messages: Message[],
  callbacks: AgentCallbacks
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  // Non-streaming mode for better tool call reliability
  if (!USE_STREAMING) {
    if (DEBUG) {
      console.error("\n[DEBUG] Using non-streaming mode");
    }
    const result = await client.chat(messages, tools);
    if (DEBUG) {
      console.error("\n[DEBUG] Response:", JSON.stringify(result, null, 2));
    }
    if (result.content) {
      callbacks.onToken(result.content);
    }
    return {
      content: result.content,
      toolCalls: result.toolCalls || [],
    };
  }

  // Streaming mode
  let content = "";
  let toolCalls: ToolCall[] = [];

  for await (const chunk of client.chatStream(messages, tools)) {
    if (DEBUG) {
      console.error("\n[DEBUG] Chunk:", JSON.stringify(chunk, null, 2));
    }

    // Native Ollama format: chunk.message.content
    if (chunk.message?.content) {
      content += chunk.message.content;
      callbacks.onToken(chunk.message.content);
    }

    // Tool calls can come during streaming or in the final message
    if (chunk.message?.tool_calls && chunk.message.tool_calls.length > 0) {
      if (DEBUG) {
        console.error("\n[DEBUG] Found tool calls:", chunk.message.tool_calls);
      }
      toolCalls = chunk.message.tool_calls.map((tc, i) => ({
        id: `call_${i}`,
        type: "function" as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));
    }
  }

  if (DEBUG) {
    console.error("\n[DEBUG] Final toolCalls:", toolCalls);
  }

  return { content, toolCalls };
}

export { formatToolCall };
