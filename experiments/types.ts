/**
 * Shared types for nemotron-cli experiments.
 */

import type { AgentConfig } from "../src/agent/config.ts";

/**
 * What gets fed into each variant for a single benchmark task.
 * The variant receives this and must produce an AgentOutput.
 */
export interface AgentInput {
  /** The instruction to give the agent (the "user message") */
  instruction: string;
  /** Creates an isolated temp directory with the task's starter files. Returns the path. */
  setup: () => Promise<string>;
  /** Cleans up the temp directory after scoring. */
  cleanup: (dir: string) => Promise<void>;
}

/**
 * What a variant produces after running the agent.
 * The scorer examines this to assign a score.
 */
export interface AgentOutput {
  /** The agent's final text response */
  response: string;
  /** Working directory where the agent operated */
  workDir: string;
  /** Number of tool calls the agent made */
  toolCalls: number;
  /** Number of agent loop iterations */
  iterations: number;
  /** Whether the agent completed without crashing */
  completed: boolean;
  /** Raw error message if the agent crashed */
  error?: string;
  /** Wall-clock duration of the agent run in ms */
  durationMs: number;
}

/**
 * A named AgentConfig override with metadata for the improvement loop.
 */
export interface ConfigCandidate {
  /** Short identifier (used as the variant name) */
  name: string;
  /** What we think this change will do */
  hypothesis: string;
  /** Category: "prompt", "tools", "config" */
  category: string;
  /** Partial AgentConfig overrides to apply on top of defaults */
  overrides: Partial<AgentConfig>;
}
