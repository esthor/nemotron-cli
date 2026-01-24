import { test, expect, describe } from "bun:test";
import {
  generateTaskId,
  isExploreResult,
  isPlanResult,
  isExecuteResult,
  isVerifyResult,
  type AgentResult,
  type ExploreResult,
  type PlanResult,
} from "../../src/agents/types.ts";
import {
  getAgentConfig,
  filterToolsForAgent,
  isValidAgentType,
  getAgentTypes,
} from "../../src/agents/index.ts";
import { tools } from "../../src/llm/prompts.ts";

describe("Agent Types", () => {
  test("generateTaskId creates unique 5-char IDs", () => {
    const id1 = generateTaskId();
    const id2 = generateTaskId();

    expect(id1).toHaveLength(5);
    expect(id2).toHaveLength(5);
    expect(id1).not.toBe(id2);
  });

  test("type guards correctly identify result types", () => {
    const exploreResult: ExploreResult = {
      type: "explore",
      files: [],
      directories: [],
      patterns: [],
      summary: "test",
    };

    const planResult: PlanResult = {
      type: "plan",
      steps: [],
      dependencies: [],
      considerations: [],
      summary: "test",
    };

    expect(isExploreResult(exploreResult)).toBe(true);
    expect(isPlanResult(exploreResult)).toBe(false);
    expect(isPlanResult(planResult)).toBe(true);
    expect(isExploreResult(planResult)).toBe(false);
  });
});

describe("Agent Registry", () => {
  test("getAgentTypes returns all 7 agent types", () => {
    const types = getAgentTypes();
    expect(types).toHaveLength(7);
    expect(types).toContain("explore");
    expect(types).toContain("research");
    expect(types).toContain("plan");
    expect(types).toContain("execute");
    expect(types).toContain("refactor");
    expect(types).toContain("assess");
    expect(types).toContain("verify");
  });

  test("isValidAgentType validates correctly", () => {
    expect(isValidAgentType("explore")).toBe(true);
    expect(isValidAgentType("plan")).toBe(true);
    expect(isValidAgentType("invalid")).toBe(false);
    expect(isValidAgentType("")).toBe(false);
  });

  test("getAgentConfig returns correct config for each type", () => {
    const exploreConfig = getAgentConfig("explore");
    expect(exploreConfig.type).toBe("explore");
    expect(exploreConfig.maxIterations).toBe(3);
    expect(exploreConfig.allowedTools).toContain("glob");
    expect(exploreConfig.allowedTools).toContain("grep");
    expect(exploreConfig.allowedTools).toContain("read_file");
    expect(exploreConfig.allowedTools).not.toContain("bash");

    const executeConfig = getAgentConfig("execute");
    expect(executeConfig.type).toBe("execute");
    expect(executeConfig.maxIterations).toBe(5);
    expect(executeConfig.allowedTools).toContain("bash");
    expect(executeConfig.allowedTools).toContain("write_file");
  });

  test("filterToolsForAgent restricts tools correctly", () => {
    const exploreTools = filterToolsForAgent(tools, "explore");
    const toolNames = exploreTools.map((t) => t.function.name);

    expect(toolNames).toContain("glob");
    expect(toolNames).toContain("grep");
    expect(toolNames).toContain("read_file");
    expect(toolNames).not.toContain("bash");
    expect(toolNames).not.toContain("write_file");
    expect(toolNames).not.toContain("spawn_agent");
  });

  test("execute agent has access to all file tools", () => {
    const executeTools = filterToolsForAgent(tools, "execute");
    const toolNames = executeTools.map((t) => t.function.name);

    expect(toolNames).toContain("read_file");
    expect(toolNames).toContain("write_file");
    expect(toolNames).toContain("edit_file");
    expect(toolNames).toContain("bash");
  });

  test("research agent has access to web tools", () => {
    const researchTools = filterToolsForAgent(tools, "research");
    const toolNames = researchTools.map((t) => t.function.name);

    expect(toolNames).toContain("web_search");
    expect(toolNames).toContain("web_fetch");
    expect(toolNames).toContain("read_file");
  });
});

describe("Tool Isolation", () => {
  test("no sub-agent can access spawn_agent (prevents nesting)", () => {
    const agentTypes = getAgentTypes();

    for (const agentType of agentTypes) {
      const agentTools = filterToolsForAgent(tools, agentType);
      const toolNames = agentTools.map((t) => t.function.name);
      expect(toolNames).not.toContain("spawn_agent");
    }
  });

  test("iteration limits are set appropriately", () => {
    // Fast agents: 3 iterations
    expect(getAgentConfig("explore").maxIterations).toBe(3);
    expect(getAgentConfig("assess").maxIterations).toBe(3);

    // Medium agents: 4 iterations
    expect(getAgentConfig("research").maxIterations).toBe(4);
    expect(getAgentConfig("refactor").maxIterations).toBe(4);
    expect(getAgentConfig("verify").maxIterations).toBe(4);

    // Complex agents: 5 iterations
    expect(getAgentConfig("plan").maxIterations).toBe(5);
    expect(getAgentConfig("execute").maxIterations).toBe(5);
  });
});
