/**
 * Agent Registry
 * Central configuration for all sub-agent types
 */

import type { AgentType, AgentConfig } from "./types.ts";
import { EXPLORE_PROMPT } from "./prompts/explore.ts";
import { RESEARCH_PROMPT } from "./prompts/research.ts";
import { PLAN_PROMPT } from "./prompts/plan.ts";
import { EXECUTE_PROMPT } from "./prompts/execute.ts";
import { REFACTOR_PROMPT } from "./prompts/refactor.ts";
import { ASSESS_PROMPT } from "./prompts/assess.ts";
import { VERIFY_PROMPT } from "./prompts/verify.ts";
import type { Tool } from "../llm/client.ts";

// CRITICAL: Low iteration limits enforce decomposition
// If a task needs more iterations, it should be split into multiple agents
export const AGENT_CONFIGS: Record<AgentType, AgentConfig> = {
  explore: {
    type: "explore",
    name: "Explorer",
    description: "Fast, focused file discovery - ONE specific search",
    systemPrompt: EXPLORE_PROMPT,
    allowedTools: ["glob", "grep", "read_file"],
    maxIterations: 3,
  },
  research: {
    type: "research",
    name: "Researcher",
    description: "Single web search query with focused results",
    systemPrompt: RESEARCH_PROMPT,
    allowedTools: ["web_search", "web_fetch", "read_file"],
    maxIterations: 4,
  },
  plan: {
    type: "plan",
    name: "Planner",
    description: "Design plan for ONE component/feature",
    systemPrompt: PLAN_PROMPT,
    allowedTools: ["glob", "grep", "read_file"],
    maxIterations: 5,
  },
  execute: {
    type: "execute",
    name: "Executor",
    description: "Implement ONE file or small set of related changes",
    systemPrompt: EXECUTE_PROMPT,
    allowedTools: [
      "glob",
      "grep",
      "read_file",
      "write_file",
      "edit_file",
      "bash",
    ],
    maxIterations: 5,
  },
  refactor: {
    type: "refactor",
    name: "Refactorer",
    description: "Address ONE specific code quality issue",
    systemPrompt: REFACTOR_PROMPT,
    allowedTools: ["glob", "grep", "read_file", "edit_file"],
    maxIterations: 4,
  },
  assess: {
    type: "assess",
    name: "Assessor",
    description: "Evaluate ONE specific decision or feature",
    systemPrompt: ASSESS_PROMPT,
    allowedTools: ["read_file", "glob"],
    maxIterations: 3,
  },
  verify: {
    type: "verify",
    name: "Verifier",
    description: "Run ONE test suite or validation check",
    systemPrompt: VERIFY_PROMPT,
    allowedTools: ["bash", "read_file", "glob"],
    maxIterations: 4,
  },
};

/**
 * Retrieve the configuration for the specified agent type.
 *
 * @param type - The agent type key to look up
 * @returns The AgentConfig associated with `type`
 */
export function getAgentConfig(type: AgentType): AgentConfig {
  return AGENT_CONFIGS[type];
}

/**
 * Return the subset of tools that the specified agent type is allowed to use.
 *
 * @param allTools - The list of available tools to filter
 * @param agentType - The agent type whose allowed tools determine the filter
 * @returns The filtered array of tools whose function names are permitted for `agentType`
 */
export function filterToolsForAgent(
  allTools: Tool[],
  agentType: AgentType
): Tool[] {
  const config = AGENT_CONFIGS[agentType];
  return allTools.filter((tool) =>
    config.allowedTools.includes(tool.function.name)
  );
}

/**
 * List all registered agent types.
 *
 * @returns An array of available `AgentType` values derived from the agent registry
 */
export function getAgentTypes(): AgentType[] {
  return Object.keys(AGENT_CONFIGS) as AgentType[];
}

/**
 * Determine whether a string corresponds to a registered AgentType.
 *
 * @param type - The string to validate as an agent type.
 * @returns `true` if `type` is a key in `AGENT_CONFIGS`, `false` otherwise.
 */
export function isValidAgentType(type: string): type is AgentType {
  return type in AGENT_CONFIGS;
}

/**
 * Builds a formatted list of all agent types paired with their short descriptions.
 *
 * @returns A newline-separated string where each line has the form `- <type>: <description>` for every agent in the registry
 */
export function getAgentDescriptions(): string {
  return Object.values(AGENT_CONFIGS)
    .map((config) => `- ${config.type}: ${config.description}`)
    .join("\n");
}