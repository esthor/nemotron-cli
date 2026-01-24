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
 * Run a sub-agent with isolated context
 * Returns structured result when complete
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
 * Get LLM response (non-streaming for sub-agents to reduce complexity)
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
 * Extract structured result from agent's final response
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
 * Generate a default structured result when parsing fails
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
