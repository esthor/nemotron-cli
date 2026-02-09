/**
 * Wraps nemotron-cli's runAgent as a harness-improver variant function.
 *
 * Each call:
 * 1. Calls input.setup() to create an isolated temp directory
 * 2. Runs the agent with the given AgentConfig
 * 3. Collects output metrics
 * 4. Returns AgentOutput (scorer will inspect workDir)
 * 5. Cleanup happens AFTER scoring, managed by the experiment runner
 */

import type { VariantContext } from "harness-improver";
import type { AgentConfig } from "../src/agent/config.ts";
import { defaultAgentConfig } from "../src/agent/config.ts";
import { runAgent, type AgentCallbacks } from "../src/agent/loop.ts";
import type { AgentInput, AgentOutput, ConfigCandidate } from "./types.ts";

/** How long a single agent run is allowed to take (3 minutes) */
const AGENT_RUN_TIMEOUT_MS = 180_000;

/**
 * Creates a variant function from AgentConfig overrides.
 *
 * Usage:
 *   const variantFn = createVariant({ systemPrompt: "..." });
 *   // variantFn matches (input: AgentInput, ctx: VariantContext) => Promise<AgentOutput>
 */
export function createVariant(
  overrides: Partial<AgentConfig> = {},
): (input: AgentInput, ctx: VariantContext) => Promise<AgentOutput> {
  return async (input: AgentInput, ctx: VariantContext): Promise<AgentOutput> => {
    // Build config from defaults + overrides
    const config: AgentConfig = {
      ...defaultAgentConfig(),
      ...overrides,
      // Deep-merge nested objects
      loop: { ...defaultAgentConfig().loop, ...overrides.loop },
      llm: { ...defaultAgentConfig().llm, ...overrides.llm },
      bash: { ...defaultAgentConfig().bash, ...overrides.bash },
      file: { ...defaultAgentConfig().file, ...overrides.file },
      search: { ...defaultAgentConfig().search, ...overrides.search },
    };

    // Set up the isolated workspace
    const workDir = await input.setup();
    const startMs = Date.now();

    let response = "";
    let toolCalls = 0;
    let completed = false;
    let error: string | undefined;

    // Collect tokens into response
    const callbacks: AgentCallbacks = {
      onThinking: () => {},
      onToken: (token: string) => {
        response += token;
      },
      onToolCall: (_name: string, _args: string) => {
        toolCalls++;
      },
      onToolResult: () => {},
      onComplete: () => {
        completed = true;
      },
      onError: (err: Error) => {
        error = err.message;
      },
    };

    // Prepend working directory to the instruction so the agent operates in the right place.
    // This is critical — without it the agent would use cwd which is shared.
    const instruction = [
      input.instruction,
      "",
      `IMPORTANT: All file paths are relative to this directory: ${workDir}`,
      `Use this as the base path for all file operations.`,
    ].join("\n");

    try {
      // Run with a hard timeout wrapping the entire agent loop
      const agentPromise = runAgent(instruction, [], callbacks, config);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Agent run timed out after ${AGENT_RUN_TIMEOUT_MS / 1000}s`)),
          AGENT_RUN_TIMEOUT_MS,
        ),
      );

      await Promise.race([agentPromise, timeoutPromise]);
      completed = true;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    const durationMs = Date.now() - startMs;

    // Record custom metrics via harness-improver's context
    ctx.metrics.record("tool_calls", toolCalls);
    ctx.metrics.record("agent_duration_ms", durationMs);

    // Count iterations from the response heuristic (number of tool calls as proxy)
    const iterations = Math.max(1, toolCalls);

    return {
      response,
      workDir,
      toolCalls,
      iterations,
      completed,
      error,
      durationMs,
    };
  };
}

/**
 * Creates a variant from a ConfigCandidate (convenience wrapper).
 */
export function candidateToVariant(candidate: ConfigCandidate) {
  return {
    name: candidate.name,
    fn: createVariant(candidate.overrides),
    isBaseline: false as const,
    description: candidate.hypothesis,
  };
}
