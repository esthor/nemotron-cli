/**
 * Agent configuration — all tunable knobs in one place.
 * When no config is provided, defaults match the original hardcoded behavior.
 */

import type { Tool } from "../llm/client.ts";
import { SYSTEM_PROMPT, tools as DEFAULT_TOOLS } from "../llm/prompts.ts";

export interface AgentConfig {
  /** System prompt sent as the first message */
  systemPrompt: string;

  /** Tool definitions sent to the LLM */
  tools: Tool[];

  /** Agent loop settings */
  loop: {
    /** Max tool-use iterations before stopping */
    maxIterations: number;
  };

  /** LLM connection settings */
  llm: {
    baseUrl: string;
    model: string;
  };

  /** Bash tool settings */
  bash: {
    timeoutMs: number;
    maxOutputBytes: number;
  };

  /** File tool settings */
  file: {
    maxReadBytes: number;
  };

  /** Search tool settings */
  search: {
    maxResults: number;
    /** File extensions to include in grep (without dots) */
    grepExtensions: string[];
  };
}

export function defaultAgentConfig(): AgentConfig {
  return {
    systemPrompt: SYSTEM_PROMPT,
    tools: DEFAULT_TOOLS,
    loop: {
      maxIterations: 10,
    },
    llm: {
      baseUrl: "http://localhost:11434",
      model: "nemotron-3-nano:30b",
    },
    bash: {
      timeoutMs: 30_000,
      maxOutputBytes: 50_000,
    },
    file: {
      maxReadBytes: 100 * 1024,
    },
    search: {
      maxResults: 100,
      grepExtensions: ["ts", "js", "tsx", "jsx", "json", "md", "css", "html", "py", "go", "rs"],
    },
  };
}
