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
