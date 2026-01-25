/**
 * Sub-Agent Runner
 * Executes a single sub-agent with isolated context and tool filtering
 */

import type { Message, ToolCall } from "../llm/client.ts";
import { client } from "../llm/client.ts";
import { tools as allTools } from "../llm/prompts.ts";
import { executeTool } from "../tools/index.ts";
import { getAgentConfig, filterToolsForAgent } from "./index.ts";
import type {
  SubAgentTask,
  SubAgentCallbacks,
  AgentResult,
  AgentType,
} from "./types.ts";

const DEBUG = process.env.DEBUG === "1";

/**
 * Run a sub-agent in an isolated conversation and produce a structured AgentResult.
 *
 * Orchestrates LLM turns and any tool executions required by the agent, reporting progress and tool-call events via the provided callbacks.
 *
 * @param task - The sub-agent task describing the agent type and prompt to run
 * @param callbacks - Handlers for progress updates, tool-call notifications, and token streaming
 * @returns An AgentResult parsed from the agent's final content, or a default result synthesized when parsing fails
 * @throws Propagates errors encountered while obtaining LLM responses or executing tools
 */
export async function runSubAgent(
  task: SubAgentTask,
  callbacks: SubAgentCallbacks
): Promise<AgentResult> {
  const config = getAgentConfig(task.agentType);
  const filteredTools = filterToolsForAgent(allTools, task.agentType);

  // Isolated message context for this sub-agent
  const messages: Message[] = [
    { role: "system", content: config.systemPrompt },
    { role: "user", content: task.prompt },
  ];

  let iterations = 0;
  let lastContent = "";

  callbacks.onProgress(`Starting ${config.name}...`);

  while (iterations < config.maxIterations) {
    iterations++;

    if (DEBUG) {
      console.error(
        `\n[DEBUG] ${config.name} iteration ${iterations}/${config.maxIterations}`
      );
    }

    try {
      const { content, toolCalls } = await getResponse(
        messages,
        filteredTools,
        callbacks
      );

      // Add assistant message
      const assistantMessage: Message = {
        role: "assistant",
        content: content || "",
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      };
      messages.push(assistantMessage);

      lastContent = content || lastContent;

      // If no tool calls, agent is done
      if (toolCalls.length === 0) {
        break;
      }

      // Execute tool calls
      for (const toolCall of toolCalls) {
        const argsJson = JSON.stringify(toolCall.function.arguments);
        callbacks.onToolCall(toolCall.function.name, argsJson);

        const result = await executeTool(toolCall.function.name, argsJson);

        // Add tool result to messages
        messages.push({
          role: "tool",
          content: result.output,
          tool_call_id: toolCall.id,
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      callbacks.onProgress(`Error: ${errorMsg}`);
      throw error;
    }
  }

  // Extract and parse the structured result
  return extractResult(task.agentType, lastContent, messages);
}

/**
 * Obtain a single LLM reply and any proposed tool calls for a sub-agent.
 *
 * Calls `callbacks.onToken` with the full response content if both the content and `onToken` are present.
 *
 * @param messages - Chat message history to send to the LLM
 * @param tools - Available tools the LLM may reference in its response
 * @param callbacks - Sub-agent callbacks; `onToken` will be invoked with the response content when available
 * @returns An object containing the assistant `content` and an array of `toolCalls` (empty if none)
 */
async function getResponse(
  messages: Message[],
  tools: typeof allTools,
  callbacks: SubAgentCallbacks
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const result = await client.chat(messages, tools);

  if (result.content && callbacks.onToken) {
    callbacks.onToken(result.content);
  }

  return {
    content: result.content,
    toolCalls: result.toolCalls || [],
  };
}

/**
 * Derive a structured AgentResult from the agent's final text response.
 *
 * @returns The parsed `AgentResult` if the response contains a JSON object whose `type` matches `agentType`; otherwise a default `AgentResult` synthesized for `agentType`.
 */
function extractResult(
  agentType: AgentType,
  content: string,
  messages: Message[]
): AgentResult {
  // Try to parse JSON from the content
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      // Validate it has the right type
      if (parsed.type === agentType) {
        return parsed as AgentResult;
      }
    } catch {
      // Fall through to generate default result
    }
  }

  // Generate default result based on agent type
  return generateDefaultResult(agentType, content, messages);
}

/**
 * Create a type-specific default AgentResult when the agent's final content does not contain a valid structured JSON result.
 *
 * Uses the first 500 characters of `content` (or a fallback string) as a human-readable summary and returns a minimal, valid result object shaped for the provided `agentType`.
 *
 * @param agentType - The agent type to shape the default result for (e.g., "explore", "research", "plan", "execute", "refactor", "assess", "verify")
 * @param content - The raw final assistant content; its prefix is used to populate the result `summary`
 * @param messages - The full message history for context; included only to allow callers to provide the session history if needed
 * @returns An AgentResult object populated with type-appropriate empty collections and a `summary` derived from `content`; for "assess" the `businessValue` defaults to `"medium"`, and for "verify" `passed` defaults to `true`
 */
function generateDefaultResult(
  agentType: AgentType,
  content: string,
  messages: Message[]
): AgentResult {
  const summary =
    content.slice(0, 500) || "Agent completed without explicit summary";

  switch (agentType) {
    case "explore":
      return {
        type: "explore",
        files: [],
        directories: [],
        patterns: [],
        summary,
      };
    case "research":
      return {
        type: "research",
        sources: [],
        findings: [summary],
        summary,
      };
    case "plan":
      return {
        type: "plan",
        steps: [],
        dependencies: [],
        considerations: [],
        summary,
      };
    case "execute":
      return {
        type: "execute",
        filesCreated: [],
        filesModified: [],
        commandsRun: [],
        summary,
      };
    case "refactor":
      return {
        type: "refactor",
        issues: [],
        suggestions: [],
        filesModified: [],
        summary,
      };
    case "assess":
      return {
        type: "assess",
        businessValue: "medium",
        risks: [],
        benefits: [],
        recommendation: summary,
        summary,
      };
    case "verify":
      return {
        type: "verify",
        tests: [],
        issues: [],
        passed: true,
        summary,
      };
  }
}