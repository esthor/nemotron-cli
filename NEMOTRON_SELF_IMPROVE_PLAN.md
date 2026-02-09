# nemotron-cli Self-Improvement Loop — Implementation Plan

## Prerequisite

This plan assumes the AgentConfig refactor is complete. Specifically:

- `src/agent/config.ts` exists and exports `AgentConfig` type + `defaultAgentConfig()` function
- `runAgent()` in `src/agent/loop.ts` accepts an optional 4th parameter: `config?: AgentConfig`
- All hardcoded knobs (system prompt, tool defs, max iterations, bash timeout, grep extensions, max results, file read limit) flow through `AgentConfig`
- The CLI still works with defaults when no config is passed

If this is not done yet, stop and implement the refactor plan first.

## What This Plan Does

Creates a self-improvement system where nemotron-cli tests alternative configurations of itself (different system prompts, tool descriptions, search strategies, loop parameters) against a benchmark of coding tasks, uses statistical analysis to determine which changes actually improve performance, and optionally adopts winners.

## Files to Create

```
nemotron-cli/
├── experiments/
│   ├── types.ts                    # Shared types for experiment infrastructure
│   ├── tasks.ts                    # Benchmark coding tasks with scorers
│   ├── agent-variant.ts            # Wraps runAgent as a harness-improver variant
│   ├── candidates/
│   │   ├── prompt-candidates.ts    # System prompt variations to test
│   │   ├── tool-candidates.ts      # Tool description variations to test
│   │   └── config-candidates.ts    # Parameter tuning variations to test
│   ├── run-experiment.ts           # One-shot: run a single A/B experiment
│   └── run-loop.ts                 # Autonomous self-improvement loop
└── package.json                    # (EDIT — add harness-improver dependency)
```

---

## Step 1: Install harness-improver

Edit `package.json` to add harness-improver as a dependency. Since harness-improver is a local sibling project, use a relative path:

```json
"dependencies": {
    "@clack/prompts": "^0.11.0",
    "cli-highlight": "^2.1.11",
    "harness-improver": "file:../harness-improver",
    "marked": "^17.0.1",
    "marked-terminal": "^7.3.0"
}
```

Then run `bun install`.

---

## Step 2: Create `experiments/types.ts`

This defines the input/output types that flow through every experiment.

```ts
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
```

---

## Step 3: Create `experiments/tasks.ts`

This is the benchmark — a set of small, deterministic coding tasks with automated scoring. Each task creates an isolated temp directory, gives the agent an instruction, and then scores the result by inspecting the filesystem.

**Design principles for good benchmark tasks:**

- Each task should be completable in 1-5 tool calls
- Scoring must be deterministic (file content checks, not vibes)
- Tasks should exercise different capabilities (reading, writing, editing, searching, running commands)
- Each task's temp directory is fully isolated — no shared state

```ts
/**
 * Benchmark coding tasks for evaluating nemotron-cli agent quality.
 *
 * Each task:
 * 1. Creates a temp directory with starter files via setup()
 * 2. Gives the agent an instruction
 * 3. Scores the result by inspecting files in the temp directory
 */

import type { EvaluationTask } from "harness-improver";
import type { AgentInput, AgentOutput } from "./types.ts";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Helper ───────────────────────────────────────────────

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "nemotron-bench-"));
}

async function cleanupDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

async function safeRead(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

// ── Tasks ────────────────────────────────────────────────

export const benchmarkTasks: EvaluationTask<AgentInput, AgentOutput>[] = [
  // ── TASK 1: Fix a simple bug ──
  {
    name: "fix-arithmetic-bug",
    input: {
      instruction: "There's a bug in calculator.ts — the subtract function adds instead of subtracting. Fix it.",
      setup: async () => {
        const dir = await makeTempDir();
        await writeFile(
          join(dir, "calculator.ts"),
          [
            'export function add(a: number, b: number): number {',
            '  return a + b;',
            '}',
            '',
            'export function subtract(a: number, b: number): number {',
            '  return a + b; // BUG: should subtract',
            '}',
            '',
            'export function multiply(a: number, b: number): number {',
            '  return a * b;',
            '}',
          ].join("\n")
        );
        return dir;
      },
      cleanup: cleanupDir,
    },
    scorer: async (output: AgentOutput) => {
      if (!output.completed) return 0;
      const content = await safeRead(join(output.workDir, "calculator.ts"));
      if (!content) return 0;

      let score = 0;
      // Core: subtract is fixed (a - b)
      if (/subtract.*\{[\s\S]*?return\s+a\s*-\s*b/m.test(content)) score += 0.5;
      // Didn't break add
      if (/add.*\{[\s\S]*?return\s+a\s*\+\s*b/m.test(content)) score += 0.2;
      // Didn't break multiply
      if (/multiply.*\{[\s\S]*?return\s+a\s*\*\s*b/m.test(content)) score += 0.1;
      // Efficiency bonus: done in few iterations
      if (output.iterations <= 3) score += 0.2;
      return Math.min(1, score);
    },
    weight: 1,
  },

  // ── TASK 2: Create a new file from requirements ──
  {
    name: "create-greeter-module",
    input: {
      instruction:
        "Create a file called greeter.ts that exports a function `greet(name: string): string` which returns 'Hello, {name}!'.",
      setup: async () => {
        const dir = await makeTempDir();
        // Empty workspace — agent must create from scratch
        return dir;
      },
      cleanup: cleanupDir,
    },
    scorer: async (output: AgentOutput) => {
      if (!output.completed) return 0;
      const content = await safeRead(join(output.workDir, "greeter.ts"));
      if (!content) return 0;

      let score = 0;
      // File exists and has a greet function
      if (/export\s+(function|const)\s+greet/.test(content)) score += 0.3;
      // Takes name parameter
      if (/greet\s*\(\s*name\s*:\s*string\s*\)/.test(content)) score += 0.2;
      // Returns string type
      if (/:\s*string\s*[{=]/.test(content)) score += 0.1;
      // Contains the Hello template
      if (content.includes("Hello") && content.includes("name")) score += 0.2;
      // Efficiency bonus
      if (output.iterations <= 2) score += 0.2;
      return Math.min(1, score);
    },
    weight: 1,
  },

  // ── TASK 3: Find and report information ──
  {
    name: "find-exported-functions",
    input: {
      instruction:
        "List all exported function names across all .ts files in the src/ directory. Just list the function names, one per line.",
      setup: async () => {
        const dir = await makeTempDir();
        await mkdir(join(dir, "src"), { recursive: true });
        await writeFile(
          join(dir, "src", "math.ts"),
          [
            'export function add(a: number, b: number) { return a + b; }',
            'export function multiply(a: number, b: number) { return a * b; }',
            'function _internal() { return 42; }',
          ].join("\n")
        );
        await writeFile(
          join(dir, "src", "strings.ts"),
          [
            'export function capitalize(s: string) { return s[0].toUpperCase() + s.slice(1); }',
            'export function reverse(s: string) { return s.split("").reverse().join(""); }',
          ].join("\n")
        );
        await writeFile(
          join(dir, "src", "internal.ts"),
          'function secret() { return "hidden"; }\n'
        );
        return dir;
      },
      cleanup: cleanupDir,
    },
    scorer: async (output: AgentOutput) => {
      if (!output.completed) return 0;
      const r = output.response.toLowerCase();

      let score = 0;
      // Should mention each exported function
      if (r.includes("add")) score += 0.2;
      if (r.includes("multiply")) score += 0.2;
      if (r.includes("capitalize")) score += 0.2;
      if (r.includes("reverse")) score += 0.2;
      // Should NOT mention unexported functions
      if (!r.includes("_internal") && !r.includes("secret")) score += 0.2;
      return Math.min(1, score);
    },
    weight: 1,
  },

  // ── TASK 4: Edit multiple locations in one file ──
  {
    name: "add-type-annotations",
    input: {
      instruction:
        "Add explicit return type annotations to all functions in utils.ts. Each function should have ': number' or ': string' as appropriate.",
      setup: async () => {
        const dir = await makeTempDir();
        await writeFile(
          join(dir, "utils.ts"),
          [
            'export function double(n: number) {',
            '  return n * 2;',
            '}',
            '',
            'export function square(n: number) {',
            '  return n * n;',
            '}',
            '',
            'export function greet(name: string) {',
            '  return `Hello, ${name}`;',
            '}',
          ].join("\n")
        );
        return dir;
      },
      cleanup: cleanupDir,
    },
    scorer: async (output: AgentOutput) => {
      if (!output.completed) return 0;
      const content = await safeRead(join(output.workDir, "utils.ts"));
      if (!content) return 0;

      let score = 0;
      // double should return number
      if (/double\s*\([^)]*\)\s*:\s*number/.test(content)) score += 0.25;
      // square should return number
      if (/square\s*\([^)]*\)\s*:\s*number/.test(content)) score += 0.25;
      // greet should return string
      if (/greet\s*\([^)]*\)\s*:\s*string/.test(content)) score += 0.25;
      // All functions still present and valid
      if (content.includes("n * 2") && content.includes("n * n") && content.includes("Hello")) {
        score += 0.25;
      }
      return Math.min(1, score);
    },
    weight: 1,
  },

  // ── TASK 5: Run a command and report output ──
  {
    name: "count-lines-of-code",
    input: {
      instruction:
        "Count the total number of lines of code across all .ts files in this directory (not including blank lines). Report the number.",
      setup: async () => {
        const dir = await makeTempDir();
        // 3 lines of real code
        await writeFile(join(dir, "a.ts"), "const x = 1;\nconst y = 2;\nconst z = 3;\n");
        // 2 lines of real code + 1 blank
        await writeFile(join(dir, "b.ts"), "function f() {\n\n  return 42;\n}\n");
        // Total non-blank: 3 + 3 = 6 (the function line, return line, closing brace)
        // Actually: a.ts has 3 non-blank, b.ts has 3 non-blank = 6
        return dir;
      },
      cleanup: cleanupDir,
    },
    scorer: async (output: AgentOutput) => {
      if (!output.completed) return 0;
      const r = output.response;

      // Accept 6 or 7 (depending on counting methodology — trailing newlines, etc.)
      let score = 0;
      if (/\b6\b/.test(r) || /\b7\b/.test(r)) score += 0.7;
      // Efficiency bonus
      if (output.iterations <= 3) score += 0.3;
      return Math.min(1, score);
    },
    weight: 1,
  },
];
```

---

## Step 4: Create `experiments/agent-variant.ts`

This wraps `runAgent` into a function compatible with harness-improver's `Variant<AgentInput, AgentOutput>` interface.

```ts
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
```

---

## Step 5: Create `experiments/candidates/prompt-candidates.ts`

System prompt variations to A/B test. Each modifies the system prompt in a specific, testable way.

```ts
/**
 * System prompt variations to test.
 *
 * Each candidate appends or modifies the base system prompt to test
 * whether a specific behavioral instruction improves agent performance.
 */

import type { ConfigCandidate } from "../types.ts";
import { defaultAgentConfig } from "../../src/agent/config.ts";

const BASE_PROMPT = defaultAgentConfig().systemPrompt;

export const promptCandidates: ConfigCandidate[] = [
  {
    name: "read-before-edit",
    hypothesis: "Explicitly requiring read_file before edit_file reduces failed edits",
    category: "prompt",
    overrides: {
      systemPrompt:
        BASE_PROMPT +
        `\n\n## MANDATORY RULE\nBefore using edit_file on any file, you MUST first use read_file to see its current contents. Never edit a file you haven't read in this conversation.`,
    },
  },
  {
    name: "search-first",
    hypothesis: "Requiring grep/glob before reading files reduces wasted reads",
    category: "prompt",
    overrides: {
      systemPrompt:
        BASE_PROMPT +
        `\n\n## SEARCH BEFORE READ\nWhen you need to find something in a codebase:\n1. FIRST use glob to find relevant files\n2. THEN use grep to narrow down to specific locations\n3. ONLY THEN use read_file on the specific files you need\nNever read files speculatively.`,
    },
  },
  {
    name: "think-step-by-step",
    hypothesis: "Explicit chain-of-thought instructions improve task completion",
    category: "prompt",
    overrides: {
      systemPrompt:
        BASE_PROMPT +
        `\n\n## REASONING PROTOCOL\nBefore each tool call, briefly state:\n1. What you're trying to accomplish in this step\n2. Which tool you'll use and why\n3. What you expect to happen\nKeep reasoning to 1-2 sentences. Then make the tool call.`,
    },
  },
  {
    name: "verify-after-edit",
    hypothesis: "Verifying edits by re-reading files catches mistakes",
    category: "prompt",
    overrides: {
      systemPrompt:
        BASE_PROMPT +
        `\n\n## VERIFY EDITS\nAfter every edit_file or write_file call, immediately use read_file on the same file to verify the change was applied correctly. If it wasn't, fix it.`,
    },
  },
  {
    name: "minimal-tools",
    hypothesis: "Encouraging minimal tool use improves efficiency without hurting correctness",
    category: "prompt",
    overrides: {
      systemPrompt:
        BASE_PROMPT +
        `\n\n## EFFICIENCY\nComplete tasks using the fewest tool calls possible. Plan your approach before acting. Combine information from previous tool results rather than re-reading files. Prefer edit_file over write_file for existing files.`,
    },
  },
];
```

---

## Step 6: Create `experiments/candidates/tool-candidates.ts`

Variations on how tools are described to the LLM. Different descriptions can change how/when the model decides to use each tool.

```ts
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
```

---

## Step 7: Create `experiments/candidates/config-candidates.ts`

Parameter tuning — test whether different loop/tool configurations improve outcomes.

```ts
/**
 * Configuration parameter variations to test.
 *
 * These change operational parameters (timeouts, limits, iterations)
 * rather than prompts or tool descriptions.
 */

import type { ConfigCandidate } from "../types.ts";

export const configCandidates: ConfigCandidate[] = [
  {
    name: "more-iterations",
    hypothesis: "Allowing more iterations lets the agent recover from mistakes",
    category: "config",
    overrides: {
      loop: { maxIterations: 15 },
    },
  },
  {
    name: "fewer-iterations",
    hypothesis: "Fewer iterations forces more efficient tool use",
    category: "config",
    overrides: {
      loop: { maxIterations: 5 },
    },
  },
  {
    name: "larger-grep-results",
    hypothesis: "Seeing more grep results gives the agent better context",
    category: "config",
    overrides: {
      search: {
        maxResults: 250,
        grepExtensions: ["ts", "js", "tsx", "jsx", "json", "md", "css", "html", "py", "go", "rs"],
      },
    },
  },
  {
    name: "longer-bash-timeout",
    hypothesis: "Longer bash timeout prevents premature failures on slow commands",
    category: "config",
    overrides: {
      bash: { timeoutMs: 60_000, maxOutputBytes: 50_000 },
    },
  },
];
```

---

## Step 8: Create `experiments/run-experiment.ts`

One-shot experiment runner — tests a single candidate against the baseline. Useful for manual testing before running the full loop.

```ts
#!/usr/bin/env bun
/**
 * Run a single A/B experiment: baseline vs one candidate.
 *
 * Usage:
 *   bun run experiments/run-experiment.ts                      # test first prompt candidate
 *   bun run experiments/run-experiment.ts read-before-edit      # test a specific candidate by name
 *   bun run experiments/run-experiment.ts --category prompt     # test all prompt candidates sequentially
 *   bun run experiments/run-experiment.ts --list                # list available candidates
 */

import {
  experiment,
  ExperimentRunner,
  ConsoleReporter,
  MarkdownReporter,
  FileStore,
} from "harness-improver";
import type { Variant } from "harness-improver";
import { defaultAgentConfig } from "../src/agent/config.ts";
import { createVariant, candidateToVariant } from "./agent-variant.ts";
import { benchmarkTasks } from "./tasks.ts";
import { promptCandidates } from "./candidates/prompt-candidates.ts";
import { toolCandidates } from "./candidates/tool-candidates.ts";
import { configCandidates } from "./candidates/config-candidates.ts";
import type { AgentInput, AgentOutput, ConfigCandidate } from "./types.ts";

// ── Gather all candidates ────────────────────────────────

const ALL_CANDIDATES: ConfigCandidate[] = [
  ...promptCandidates,
  ...toolCandidates,
  ...configCandidates,
];

// ── Parse CLI args ───────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes("--list")) {
  console.log("Available candidates:\n");
  for (const c of ALL_CANDIDATES) {
    console.log(`  ${c.name.padEnd(25)} [${c.category}]  ${c.hypothesis}`);
  }
  process.exit(0);
}

let candidatesToTest: ConfigCandidate[];

if (args.includes("--category")) {
  const cat = args[args.indexOf("--category") + 1];
  candidatesToTest = ALL_CANDIDATES.filter((c) => c.category === cat);
  if (candidatesToTest.length === 0) {
    console.error(`No candidates found for category: ${cat}`);
    console.error(`Available categories: prompt, tools, config`);
    process.exit(1);
  }
} else if (args.length > 0 && !args[0].startsWith("--")) {
  const name = args[0];
  const found = ALL_CANDIDATES.find((c) => c.name === name);
  if (!found) {
    console.error(`Candidate not found: ${name}`);
    console.error(`Run with --list to see available candidates.`);
    process.exit(1);
  }
  candidatesToTest = [found];
} else {
  // Default: test first prompt candidate
  candidatesToTest = [promptCandidates[0]];
}

// ── Run experiments ──────────────────────────────────────

const store = new FileStore(".nemotron-experiments/results");
const useMarkdown = args.includes("--markdown");
const reporter = useMarkdown ? new MarkdownReporter() : new ConsoleReporter();

for (const candidate of candidatesToTest) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Testing: ${candidate.name}`);
  console.log(`Hypothesis: ${candidate.hypothesis}`);
  console.log(`Category: ${candidate.category}`);
  console.log(`${"=".repeat(60)}\n`);

  const baselineVariant: Variant<AgentInput, AgentOutput> = {
    name: "baseline",
    fn: createVariant(),
    isBaseline: true,
    description: "Current default configuration",
  };

  const challengerVariant = candidateToVariant(candidate);

  // Build experiment using the builder API
  // We use the lower-level ExperimentConfig directly because we already have
  // Variant objects and EvaluationTask objects from our modules.
  const config = experiment<AgentInput, AgentOutput>(`nemotron_${candidate.name}`)
    .description(`Test: ${candidate.hypothesis}`)
    .variant("baseline", baselineVariant.fn, { isBaseline: true })
    .variant(candidate.name, challengerVariant.fn)
    .tasks(benchmarkTasks)
    .runs(3) // 3 runs per variant per task (each is a full LLM interaction)
    .warmup(1) // 1 warmup run to prime Ollama's KV cache
    .timeout(200_000) // 200s per individual run (generous for LLM calls)
    .concurrency(1) // Sequential — don't overload Ollama
    .randomize(true)
    .seed(42) // Reproducible run order
    .primaryMetric("score")
    .testSelection("auto")
    .bootstrapSamples(2000) // Lower than default (small sample, fast iteration)
    .effectSizeThreshold(0.2)
    .customMetrics("tool_calls", "agent_duration_ms")
    .build();

  const runner = new ExperimentRunner({
    store,
    reporters: [reporter],
    onProgress: (completed, total, run) => {
      process.stdout.write(
        `\r  [${completed}/${total}] ${run.variantName} / ${run.taskName} — ${run.success ? "ok" : "FAIL"}   `,
      );
    },
  });

  try {
    const result = await runner.run(config);

    // Cleanup: all temp dirs from this experiment
    for (const run of result.runs) {
      const output = run.output as AgentOutput | undefined;
      if (output?.workDir) {
        const task = benchmarkTasks.find((t) => t.name === run.taskName);
        await task?.input.cleanup(output.workDir);
      }
    }
  } catch (e) {
    console.error(`\nExperiment failed: ${e instanceof Error ? e.message : e}`);
  }
}

console.log("\nDone. Results saved to .nemotron-experiments/results/");
```

---

## Step 9: Create `experiments/run-loop.ts`

The autonomous self-improvement loop. This iterates through all candidates, tests each one, and adopts winners.

```ts
#!/usr/bin/env bun
/**
 * Autonomous self-improvement loop for nemotron-cli.
 *
 * Iterates through candidate configurations, tests each against the current
 * baseline, and adopts winners that pass statistical and safety checks.
 *
 * Usage:
 *   bun run experiments/run-loop.ts
 *   bun run experiments/run-loop.ts --dry-run    # analyze but don't write changes
 *   bun run experiments/run-loop.ts --category prompt  # only test prompt candidates
 */

import {
  experiment,
  ExperimentRunner,
  ImprovementLoop,
  ThresholdAdoption,
  ConsoleReporter,
  FileStore,
  defaultSafetyConfig,
} from "harness-improver";
import type { Variant, ImprovementCandidate } from "harness-improver";
import { defaultAgentConfig } from "../src/agent/config.ts";
import { createVariant, candidateToVariant } from "./agent-variant.ts";
import { benchmarkTasks } from "./tasks.ts";
import { promptCandidates } from "./candidates/prompt-candidates.ts";
import { toolCandidates } from "./candidates/tool-candidates.ts";
import { configCandidates } from "./candidates/config-candidates.ts";
import type { AgentInput, AgentOutput, ConfigCandidate } from "./types.ts";
import { writeFile, readFile, copyFile } from "node:fs/promises";
import { join } from "node:path";

// ── CLI args ─────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const categoryFilter = args.includes("--category")
  ? args[args.indexOf("--category") + 1]
  : null;

// ── Gather candidates ────────────────────────────────────

let allCandidates: ConfigCandidate[] = [
  ...promptCandidates,
  ...toolCandidates,
  ...configCandidates,
];

if (categoryFilter) {
  allCandidates = allCandidates.filter((c) => c.category === categoryFilter);
}

if (allCandidates.length === 0) {
  console.error("No candidates to test.");
  process.exit(1);
}

console.log(`Nemotron-CLI Self-Improvement Loop`);
console.log(`${"=".repeat(50)}`);
console.log(`Candidates: ${allCandidates.length}`);
console.log(`Tasks: ${benchmarkTasks.length}`);
console.log(`Dry run: ${dryRun}`);
console.log(`Category filter: ${categoryFilter ?? "all"}`);
console.log(`${"=".repeat(50)}\n`);

// ── Candidate generator ─────────────────────────────────

let candidateIndex = 0;

async function generateCandidates(): Promise<ImprovementCandidate<AgentInput, AgentOutput>[]> {
  if (candidateIndex >= allCandidates.length) return [];

  const candidate = allCandidates[candidateIndex++];
  console.log(`\n--- Candidate ${candidateIndex}/${allCandidates.length}: ${candidate.name} ---`);
  console.log(`Hypothesis: ${candidate.hypothesis}\n`);

  return [
    {
      variant: candidateToVariant(candidate),
      hypothesis: candidate.hypothesis,
      source: candidate.category,
    },
  ];
}

// ── Build base experiment config ─────────────────────────

const baselineVariant: Variant<AgentInput, AgentOutput> = {
  name: "baseline",
  fn: createVariant(),
  isBaseline: true,
};

// Placeholder challenger — ImprovementLoop replaces this with each candidate
const placeholderVariant: Variant<AgentInput, AgentOutput> = {
  name: "placeholder",
  fn: async () => ({
    response: "",
    workDir: "",
    toolCalls: 0,
    iterations: 0,
    completed: false,
    durationMs: 0,
  }),
  isBaseline: false,
};

const baseExperiment = experiment<AgentInput, AgentOutput>("nemotron-self-improve")
  .description("Autonomous improvement of nemotron-cli agent configuration")
  .variant("baseline", baselineVariant.fn, { isBaseline: true })
  .variant("placeholder", placeholderVariant.fn)
  .tasks(benchmarkTasks)
  .runs(3)
  .warmup(1)
  .timeout(200_000)
  .concurrency(1)
  .randomize(true)
  .seed(42)
  .primaryMetric("score")
  .testSelection("auto")
  .bootstrapSamples(2000)
  .effectSizeThreshold(0.2)
  .customMetrics("tool_calls", "agent_duration_ms")
  .build();

// ── Adoption callbacks ───────────────────────────────────

const adoptedChanges: ConfigCandidate[] = [];

async function onAdopt(
  variant: Variant<AgentInput, AgentOutput>,
  result: import("harness-improver").ExperimentResult,
): Promise<void> {
  const candidate = allCandidates.find((c) => c.name === variant.name);
  if (!candidate) return;

  adoptedChanges.push(candidate);

  console.log(`\n${"*".repeat(50)}`);
  console.log(`ADOPTED: ${variant.name}`);
  console.log(`Hypothesis confirmed: ${candidate.hypothesis}`);
  console.log(`${"*".repeat(50)}`);

  if (dryRun) {
    console.log(`[DRY RUN] Would write changes to src/agent/config.ts`);
    return;
  }

  // Write the winning config change to a log file so the user can review and apply
  const logPath = `.nemotron-experiments/adopted/${candidate.name}.json`;
  const { mkdir } = await import("node:fs/promises");
  await mkdir(".nemotron-experiments/adopted", { recursive: true });
  await writeFile(
    logPath,
    JSON.stringify(
      {
        name: candidate.name,
        category: candidate.category,
        hypothesis: candidate.hypothesis,
        overrides: candidate.overrides,
        adoptedAt: new Date().toISOString(),
        experimentName: result.experimentName,
        recommendation: result.analysis.recommendation,
      },
      null,
      2,
    ),
  );
  console.log(`Saved winning config to: ${logPath}`);
  console.log(`To apply: review the file and update src/agent/config.ts accordingly.\n`);
}

async function onReject(variant: Variant<AgentInput, AgentOutput>): Promise<void> {
  console.log(`\nRejected: ${variant.name}`);
}

// ── Safety configuration ─────────────────────────────────

const safety = defaultSafetyConfig();
safety.requireMinRuns = 3;
safety.requireMinEffectSize = 0.2;
safety.requireSignificance = true;
safety.maxRegressionsBeforeHalt = 3;
safety.rollbackOnRegression = true;

// ── Adoption strategy ────────────────────────────────────
// ThresholdAdoption: configurable cutoffs for p-value, effect size, Bayesian probability

const adoptionStrategy = new ThresholdAdoption({
  maxPValue: 0.10, // Slightly relaxed — small sample sizes make p<0.05 hard
  minEffectSize: 0.3, // Require at least a small-to-medium effect
  minProbBetter: 0.80, // Bayesian probability threshold
});

// ── Runner setup ─────────────────────────────────────────

const store = new FileStore(".nemotron-experiments/results");
const reporter = new ConsoleReporter();

const runner = new ExperimentRunner({
  store,
  reporters: [reporter],
  onProgress: (completed, total, run) => {
    process.stdout.write(
      `\r  [${completed}/${total}] ${run.variantName} / ${run.taskName} — ${run.success ? "ok" : "FAIL"}   `,
    );
  },
});

// ── Run the loop ─────────────────────────────────────────

const loop = new ImprovementLoop<AgentInput, AgentOutput>(
  {
    experiment: baseExperiment,
    candidateGenerator: generateCandidates,
    adoptionStrategy,
    safety,
    onAdopt,
    onReject,
    maxIterations: allCandidates.length,
  },
  runner,
);

const result = await loop.run();

// ── Summary ──────────────────────────────────────────────

console.log(`\n${"=".repeat(60)}`);
console.log(`SELF-IMPROVEMENT LOOP COMPLETE`);
console.log(`${"=".repeat(60)}`);
console.log(`Candidates tested: ${result.totalIterations}`);
console.log(`Adopted: ${result.adopted}`);
console.log(`Rejected: ${result.rejected}`);
if (result.halted) {
  console.log(`Halted: ${result.haltReason}`);
}

console.log(`\nDetailed results:`);
for (const entry of result.iterations) {
  const icon = entry.adopted ? "+" : "-";
  console.log(`  [${icon}] ${entry.candidate.padEnd(25)} ${entry.reason}`);
}

if (adoptedChanges.length > 0) {
  console.log(`\nAdopted configurations:`);
  for (const c of adoptedChanges) {
    console.log(`  - ${c.name}: ${c.hypothesis}`);
  }
  console.log(`\nReview adopted configs in .nemotron-experiments/adopted/`);
} else {
  console.log(`\nNo candidates were adopted. The current configuration is holding up.`);
}

// ── Cleanup temp dirs ────────────────────────────────────
// The improvement loop doesn't handle cleanup of AgentOutput.workDir,
// so we do a best-effort sweep here.

console.log(`\nCleaning up temporary directories...`);
const { rm } = await import("node:fs/promises");
const { tmpdir: getTmpdir } = await import("node:os");
// Temp dirs are named nemotron-bench-* and were created during task setup
// They should already be cleaned up by the experiment runner, but just in case:
try {
  const { readdirSync } = await import("node:fs");
  const tmp = getTmpdir();
  const stale = readdirSync(tmp).filter((f) => f.startsWith("nemotron-bench-"));
  for (const dir of stale) {
    await rm(join(tmp, dir), { recursive: true, force: true });
  }
  if (stale.length > 0) {
    console.log(`Cleaned up ${stale.length} temp directories.`);
  }
} catch {
  // best-effort
}

console.log(`\nDone.`);
```

---

## Step 10: Create `experiments/` directory README (optional but helpful)

Not a code file — skip if you prefer. But if you want a quick reference:

Create `.nemotron-experiments/.gitkeep` to ensure the results directory exists:

```bash
mkdir -p .nemotron-experiments/results .nemotron-experiments/adopted
touch .nemotron-experiments/.gitkeep
```

Add to `.gitignore`:

```
.nemotron-experiments/results/
.nemotron-experiments/adopted/
```

---

## Verification Checklist

After implementing all files, verify in this order:

1. **`bun install`** — harness-improver resolves from `file:../harness-improver`

2. **`bun run experiments/run-experiment.ts --list`** — prints all candidates:
   ```
   Available candidates:

     read-before-edit          [prompt]  Explicitly requiring read_file before edit_file reduces failed edits
     search-first              [prompt]  Requiring grep/glob before reading files reduces wasted reads
     ...
   ```

3. **Ollama is running** with the nemotron model:
   ```bash
   ollama list  # should show nemotron-3-nano:30b
   ```

4. **Single experiment** — test one candidate to make sure the full pipeline works:
   ```bash
   bun run experiments/run-experiment.ts read-before-edit
   ```
   This should:
   - Create temp directories for each task
   - Run the baseline agent 3× per task (+ 1 warmup)
   - Run the challenger agent 3× per task (+ 1 warmup)
   - Print statistical analysis with p-value, effect size, CI
   - Save results to `.nemotron-experiments/results/`
   - Clean up temp directories

5. **Full loop** (dry run first):
   ```bash
   bun run experiments/run-loop.ts --dry-run
   ```

6. **Full loop** (real):
   ```bash
   bun run experiments/run-loop.ts
   ```

7. **Check adopted results**:
   ```bash
   ls .nemotron-experiments/adopted/
   cat .nemotron-experiments/adopted/*.json
   ```

---

## Runtime Expectations

- Each agent run takes 10-60 seconds (depends on Ollama speed and task complexity)
- Each candidate test = (3 runs + 1 warmup) × 5 tasks × 2 variants = 40 agent runs ≈ 15-40 minutes
- Full loop with 11 candidates ≈ 3-7 hours
- Use `--category prompt` to test just the 5 prompt candidates first (~1.5-3 hours)

---

## How to Add More Candidates Later

1. Add a new `ConfigCandidate` object to the appropriate file in `experiments/candidates/`
2. Run `bun run experiments/run-experiment.ts your-candidate-name`
3. If it wins, the config is saved to `.nemotron-experiments/adopted/`

To test an LLM-generated prompt variation, add it to `prompt-candidates.ts`:

```ts
{
  name: "llm-suggestion-1",
  hypothesis: "LLM-proposed improvement to tool selection guidance",
  category: "prompt",
  overrides: {
    systemPrompt: "... the full new prompt ...",
  },
},
```

---

## Summary of Files

| File | Lines | Purpose |
|---|---|---|
| `experiments/types.ts` | ~45 | AgentInput, AgentOutput, ConfigCandidate types |
| `experiments/tasks.ts` | ~200 | 5 benchmark coding tasks with automated scorers |
| `experiments/agent-variant.ts` | ~110 | Wraps runAgent as harness-improver variant |
| `experiments/candidates/prompt-candidates.ts` | ~65 | 5 system prompt variations |
| `experiments/candidates/tool-candidates.ts` | ~55 | 2 tool description variations |
| `experiments/candidates/config-candidates.ts` | ~45 | 4 parameter tuning variations |
| `experiments/run-experiment.ts` | ~120 | One-shot A/B test CLI |
| `experiments/run-loop.ts` | ~200 | Autonomous improvement loop |
| **Total** | **~840** | |
