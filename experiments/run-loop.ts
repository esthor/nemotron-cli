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
