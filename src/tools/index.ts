/**
 * Tool registry and executor
 */

import { readFile, writeFile, editFile } from "./file.ts";
import { bash } from "./bash.ts";
import { glob, grep } from "./search.ts";
import { webSearch, webFetch } from "./web.ts";
import type { AgentType, AgentResult } from "../agents/types.ts";
import { isValidAgentType } from "../agents/index.ts";

export type ToolResult = {
  success: boolean;
  output: string;
};

type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

// Agent spawn handler - set from main loop to integrate with TUI
let spawnAgentHandler:
  | ((agentType: AgentType, prompt: string) => Promise<AgentResult>)
  | null = null;

/**
 * Registers the handler used by the tool system to spawn agents.
 *
 * @param handler - Function that, given an agent type and a prompt, produces an AgentResult describing the spawned agent's outcome.
 */
export function setSpawnAgentHandler(
  handler: (agentType: AgentType, prompt: string) => Promise<AgentResult>
): void {
  spawnAgentHandler = handler;
}

/**
 * Determine whether an agent spawn handler has been registered.
 *
 * @returns `true` if a spawn agent handler is registered and available, `false` otherwise.
 */
export function isSpawnAgentAvailable(): boolean {
  return spawnAgentHandler !== null;
}

const toolHandlers: Record<string, ToolHandler> = {
  spawn_agent: async (args) => {
    const agentType = args.agent_type as string;
    const prompt = args.prompt as string;

    if (!agentType || !prompt) {
      throw new Error("spawn_agent requires agent_type and prompt");
    }

    if (!isValidAgentType(agentType)) {
      throw new Error(
        `Invalid agent type: ${agentType}. Valid types: explore, research, plan, execute, refactor, assess, verify`
      );
    }

    if (!spawnAgentHandler) {
      throw new Error(
        "spawn_agent not available - agent context not initialized"
      );
    }

    const result = await spawnAgentHandler(agentType as AgentType, prompt);
    return JSON.stringify(result, null, 2);
  },

  read_file: async (args) => {
    return readFile(args.path as string);
  },

  write_file: async (args) => {
    return writeFile(args.path as string, args.content as string);
  },

  edit_file: async (args) => {
    return editFile(
      args.path as string,
      args.search as string,
      args.replace as string
    );
  },

  bash: async (args) => {
    return bash(args.command as string);
  },

  glob: async (args) => {
    return glob(args.pattern as string);
  },

  grep: async (args) => {
    return grep(args.pattern as string, args.path as string | undefined);
  },

  web_search: async (args) => {
    return webSearch(args.query as string);
  },

  web_fetch: async (args) => {
    return webFetch(args.url as string);
  },
};

/**
 * Execute a registered tool by name using a JSON-encoded arguments object.
 *
 * @param name - The tool identifier to invoke
 * @param argsJson - A JSON string representing the tool's arguments (parsed to a plain object)
 * @returns An object with `success` and `output`: `success` is `true` if the tool handler completed successfully, `false` otherwise; `output` is the handler's result on success or an error message (for example, `Unknown tool: <name>` or `Error: <message>`). 
 */
export async function executeTool(
  name: string,
  argsJson: string
): Promise<ToolResult> {
  const handler = toolHandlers[name];

  if (!handler) {
    return {
      success: false,
      output: `Unknown tool: ${name}`,
    };
  }

  try {
    const args = JSON.parse(argsJson) as Record<string, unknown>;
    const output = await handler(args);
    return { success: true, output };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, output: `Error: ${message}` };
  }
}

/**
 * Format a tool invocation into a concise, human-readable string.
 *
 * @param argsJson - A JSON-encoded object of argument key/value pairs; string values longer than 50 characters are truncated with `...` for brevity.
 * @returns A string in the form `name(key: value, ...)`. If `argsJson` is not valid JSON, returns `name(argsJson)` with the raw input. 
 */
export function formatToolCall(name: string, argsJson: string): string {
  try {
    const args = JSON.parse(argsJson) as Record<string, unknown>;
    const argStr = Object.entries(args)
      .map(([k, v]) => {
        const val =
          typeof v === "string" && v.length > 50 ? v.slice(0, 50) + "..." : v;
        return `${k}: ${JSON.stringify(val)}`;
      })
      .join(", ");
    return `${name}(${argStr})`;
  } catch {
    return `${name}(${argsJson})`;
  }
}