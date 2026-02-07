/**
 * Tool registry and executor
 */

import { readFile, writeFile, editFile } from "./file.ts";
import { bash } from "./bash.ts";
import { glob, grep } from "./search.ts";
import type { AgentConfig } from "../agent/config.ts";
import { defaultAgentConfig } from "../agent/config.ts";

export type ToolResult = {
  success: boolean;
  output: string;
};

type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

export async function executeTool(
  name: string,
  argsJson: string,
  config?: AgentConfig
): Promise<ToolResult> {
  const cfg = config ?? defaultAgentConfig();

  const toolHandlers: Record<string, ToolHandler> = {
    read_file: async (args) => {
      return readFile(args.path as string, cfg.file);
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
      return bash(args.command as string, cfg.bash);
    },

    glob: async (args) => {
      return glob(args.pattern as string, cfg.search);
    },

    grep: async (args) => {
      return grep(args.pattern as string, args.path as string | undefined, cfg.search);
    },
  };

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
        const val = typeof v === "string" && v.length > 50
          ? v.slice(0, 50) + "..."
          : v;
        return `${k}: ${JSON.stringify(val)}`;
      })
      .join(", ");
    return `${name}(${argStr})`;
  } catch {
    return `${name}(${argsJson})`;
  }
}
