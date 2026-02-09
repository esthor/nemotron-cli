/**
 * Tool description variations to test.
 *
 * Changes only the description strings in tool definitions,
 * not the tool implementations themselves.
 */

import type { ConfigCandidate } from "../types.ts";
import { defaultAgentConfig } from "../../src/agent/config.ts";
import type { Tool } from "../../src/llm/client.ts";

const defaultTools = defaultAgentConfig().tools;

function cloneTools(tools: Tool[]): Tool[] {
  return JSON.parse(JSON.stringify(tools));
}

function replaceToolDescription(tools: Tool[], toolName: string, newDesc: string): Tool[] {
  const cloned = cloneTools(tools);
  const tool = cloned.find((t) => t.function.name === toolName);
  if (tool) tool.function.description = newDesc;
  return cloned;
}

export const toolCandidates: ConfigCandidate[] = [
  {
    name: "verbose-edit-desc",
    hypothesis: "More detailed edit_file description reduces misuse",
    category: "tools",
    overrides: {
      tools: replaceToolDescription(
        defaultTools,
        "edit_file",
        "Edit a file by replacing the FIRST occurrence of an exact search string with a replacement string. " +
          "The search string must match the file content EXACTLY, including whitespace and indentation. " +
          "Always read_file first to see the exact content you need to match. " +
          "Use this for targeted single edits; for rewriting entire files, use write_file instead.",
      ),
    },
  },
  {
    name: "verbose-grep-desc",
    hypothesis: "Better grep description improves search quality",
    category: "tools",
    overrides: {
      tools: replaceToolDescription(
        defaultTools,
        "grep",
        "Search for a regex pattern across files. Returns matching lines with file paths and line numbers. " +
          "Searches TypeScript, JavaScript, JSON, Markdown, and other common source files. " +
          "Use this to find function definitions, variable usage, imports, or any text pattern. " +
          "More efficient than reading entire files when you know what you're looking for. " +
          "The pattern argument supports extended regex (ERE) syntax.",
      ),
    },
  },
];
