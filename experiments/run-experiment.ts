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
