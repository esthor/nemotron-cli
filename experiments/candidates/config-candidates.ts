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
