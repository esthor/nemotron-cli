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
 * Set the spawn_agent handler (called from main loop setup)
 */
export function setSpawnAgentHandler(
  handler: (agentType: AgentType, prompt: string) => Promise<AgentResult>
): void {
  spawnAgentHandler = handler;
}

/**
 * Check if spawn_agent is available
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
