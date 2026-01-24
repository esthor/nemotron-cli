/**
 * Agent Type System
 * Defines types for sub-agents with structured results
 */

export type AgentType =
  | "explore"
  | "research"
  | "plan"
  | "execute"
  | "refactor"
  | "assess"
  | "verify";

export interface AgentConfig {
  type: AgentType;
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  maxIterations: number;
}

export interface SubAgentTask {
  id: string;
  agentType: AgentType;
  prompt: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: AgentResult;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

// Structured result types per agent - enforces small, focused outputs

export interface ExploreResult {
  type: "explore";
  files: { path: string; description: string }[];
  directories: { path: string; purpose: string }[];
  patterns: string[];
  summary: string;
}

export interface ResearchResult {
  type: "research";
  sources: { url: string; title: string; relevance: string }[];
  findings: string[];
  summary: string;
}

export interface PlanResult {
  type: "plan";
  steps: {
    id: number;
    description: string;
    files: string[];
    risk: "low" | "medium" | "high";
  }[];
  dependencies: string[];
  considerations: string[];
  summary: string;
}

export interface ExecuteResult {
  type: "execute";
  filesCreated: string[];
  filesModified: string[];
  commandsRun: { command: string; success: boolean; output?: string }[];
  summary: string;
}

export interface RefactorResult {
  type: "refactor";
  issues: {
    file: string;
    line?: number;
    issue: string;
    severity: "info" | "warning" | "error";
  }[];
  suggestions: string[];
  filesModified: string[];
  summary: string;
}

export interface AssessResult {
  type: "assess";
  businessValue: "low" | "medium" | "high";
  risks: string[];
  benefits: string[];
  recommendation: string;
  summary: string;
}

export interface VerifyResult {
  type: "verify";
  tests: { name: string; passed: boolean; output?: string }[];
  coverage?: number;
  issues: string[];
  passed: boolean;
  summary: string;
}

export type AgentResult =
  | ExploreResult
  | ResearchResult
  | PlanResult
  | ExecuteResult
  | RefactorResult
  | AssessResult
  | VerifyResult;

// Callbacks for agent execution progress
export interface SubAgentCallbacks {
  onProgress: (message: string) => void;
  onToolCall: (tool: string, args: string) => void;
  onToken?: (token: string) => void;
}

// Utility type guards
export function isExploreResult(result: AgentResult): result is ExploreResult {
  return result.type === "explore";
}

export function isResearchResult(
  result: AgentResult
): result is ResearchResult {
  return result.type === "research";
}

export function isPlanResult(result: AgentResult): result is PlanResult {
  return result.type === "plan";
}

export function isExecuteResult(result: AgentResult): result is ExecuteResult {
  return result.type === "execute";
}

export function isRefactorResult(
  result: AgentResult
): result is RefactorResult {
  return result.type === "refactor";
}

export function isAssessResult(result: AgentResult): result is AssessResult {
  return result.type === "assess";
}

export function isVerifyResult(result: AgentResult): result is VerifyResult {
  return result.type === "verify";
}

// Generate unique task ID
export function generateTaskId(): string {
  return Math.random().toString(36).substring(2, 7);
}
