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
