# nemotron-cli Refactor Plan: Make Agent Knobs Tunable for Experimentation

## Goal

Refactor nemotron-cli so that all hardcoded agent behavior (system prompt, tool definitions, tool configs, agent loop params) becomes injectable via a single `AgentConfig` object. This enables harness-improver to run A/B experiments by swapping configs without touching source files.

**Constraint:** The CLI must work exactly as before when no config is provided (all current hardcoded values become defaults). This is a pure refactor — zero behavior change for existing users.

---

## Files to Modify (in order)

1. `src/agent/config.ts` — **NEW FILE** — config type + defaults
2. `src/tools/bash.ts` — accept config params instead of hardcoded constants
3. `src/tools/file.ts` — accept config params
4. `src/tools/search.ts` — accept config params
5. `src/tools/index.ts` — accept config, pass to tool handlers
6. `src/llm/prompts.ts` — export defaults, stop being the source of truth
7. `src/llm/client.ts` — accept config for model/baseUrl
8. `src/agent/loop.ts` — accept full AgentConfig, wire everything through
9. `src/index.ts` — construct default config, pass to runAgent

---

## Step 1: Create `src/agent/config.ts`

Create this new file. It defines the full config type and a function that returns defaults (using the current hardcoded values).

```ts
import type { Tool } from "../llm/client.ts";
import { SYSTEM_PROMPT, tools as DEFAULT_TOOLS } from "../llm/prompts.ts";

export interface AgentConfig {
  /** System prompt sent as the first message */
  systemPrompt: string;

  /** Tool definitions sent to the LLM */
  tools: Tool[];

  /** Agent loop settings */
  loop: {
    /** Max tool-use iterations before stopping */
    maxIterations: number;
  };

  /** LLM connection settings */
  llm: {
    baseUrl: string;
    model: string;
  };

  /** Bash tool settings */
  bash: {
    timeoutMs: number;
    maxOutputBytes: number;
  };

  /** File tool settings */
  file: {
    maxReadBytes: number;
  };

  /** Search tool settings */
  search: {
    maxResults: number;
    /** File extensions to include in grep (without dots) */
    grepExtensions: string[];
  };
}

export function defaultAgentConfig(): AgentConfig {
  return {
    systemPrompt: SYSTEM_PROMPT,
    tools: DEFAULT_TOOLS,
    loop: {
      maxIterations: 10,
    },
    llm: {
      baseUrl: "http://localhost:11434",
      model: "nemotron-3-nano:30b",
    },
    bash: {
      timeoutMs: 30_000,
      maxOutputBytes: 50_000,
    },
    file: {
      maxReadBytes: 100 * 1024,
    },
    search: {
      maxResults: 100,
      grepExtensions: ["ts", "js", "tsx", "jsx", "json", "md", "css", "html", "py", "go", "rs"],
    },
  };
}
```

---

## Step 2: Modify `src/tools/bash.ts`

**Current code** has hardcoded constants:

```ts
const TIMEOUT_MS = 30_000;
const MAX_OUTPUT = 50_000;

export async function bash(command: string): Promise<string> {
```

**Change to:**

```ts
export interface BashConfig {
  timeoutMs: number;
  maxOutputBytes: number;
}

const DEFAULTS: BashConfig = { timeoutMs: 30_000, maxOutputBytes: 50_000 };

export async function bash(command: string, config: BashConfig = DEFAULTS): Promise<string> {
```

Then replace every reference to `TIMEOUT_MS` with `config.timeoutMs` and `MAX_OUTPUT` with `config.maxOutputBytes`. There are exactly 3 references:

1. Line with `setTimeout` — change `TIMEOUT_MS` → `config.timeoutMs`
2. The error message `Command timed out after ${TIMEOUT_MS / 1000}s` → `Command timed out after ${config.timeoutMs / 1000}s`
3. Line with `output.length > MAX_OUTPUT` — change `MAX_OUTPUT` → `config.maxOutputBytes`, same for the `.slice(0, MAX_OUTPUT)` on the next line

Delete the two `const` lines (`TIMEOUT_MS` and `MAX_OUTPUT`).

---

## Step 3: Modify `src/tools/file.ts`

**Current code:**

```ts
const MAX_FILE_SIZE = 100 * 1024;

export async function readFile(path: string): Promise<string> {
```

**Change to:**

```ts
export interface FileConfig {
  maxReadBytes: number;
}

const DEFAULTS: FileConfig = { maxReadBytes: 100 * 1024 };

export async function readFile(path: string, config: FileConfig = DEFAULTS): Promise<string> {
```

Replace `MAX_FILE_SIZE` with `config.maxReadBytes` (2 occurrences in `readFile`). Delete the `const MAX_FILE_SIZE` line.

`writeFile` and `editFile` don't need config changes — leave their signatures alone.

---

## Step 4: Modify `src/tools/search.ts`

**Current code:**

```ts
const MAX_RESULTS = 100;

export async function glob(pattern: string): Promise<string> {
```

And `grep` has hardcoded `--include` flags.

**Change to:**

```ts
export interface SearchConfig {
  maxResults: number;
  grepExtensions: string[];
}

const DEFAULTS: SearchConfig = {
  maxResults: 100,
  grepExtensions: ["ts", "js", "tsx", "jsx", "json", "md", "css", "html", "py", "go", "rs"],
};

export async function glob(pattern: string, config: SearchConfig = DEFAULTS): Promise<string> {
```

Replace `MAX_RESULTS` with `config.maxResults` in both `glob` and `grep` (4 occurrences total). Delete the `const MAX_RESULTS` line.

For `grep`, change the signature:

```ts
export async function grep(pattern: string, path?: string, config: SearchConfig = DEFAULTS): Promise<string> {
```

Replace the hardcoded `--include` list. Currently it's:

```ts
"--include=*.ts",
"--include=*.js",
"--include=*.tsx",
"--include=*.jsx",
"--include=*.json",
"--include=*.md",
"--include=*.css",
"--include=*.html",
"--include=*.py",
"--include=*.go",
"--include=*.rs",
```

Replace with:

```ts
...config.grepExtensions.map(ext => `--include=*.${ext}`),
```

---

## Step 5: Modify `src/tools/index.ts`

**Current code** creates `toolHandlers` at module level with no config:

```ts
const toolHandlers: Record<string, ToolHandler> = {
  read_file: async (args) => readFile(args.path as string),
  bash: async (args) => bash(args.command as string),
  glob: async (args) => glob(args.pattern as string),
  grep: async (args) => grep(args.pattern as string, args.path as string | undefined),
  // ...
};
```

**Change:** Make `executeTool` accept config and pass it to tool functions. Import the config type.

```ts
import type { AgentConfig } from "../agent/config.ts";
import { defaultAgentConfig } from "../agent/config.ts";
```

Change `executeTool` signature:

```ts
export async function executeTool(
  name: string,
  argsJson: string,
  config?: AgentConfig
): Promise<ToolResult> {
  const cfg = config ?? defaultAgentConfig();

  const toolHandlers: Record<string, ToolHandler> = {
    read_file: async (args) => readFile(args.path as string, cfg.file),
    write_file: async (args) => writeFile(args.path as string, args.content as string),
    edit_file: async (args) => editFile(args.path as string, args.search as string, args.replace as string),
    bash: async (args) => bash(args.command as string, cfg.bash),
    glob: async (args) => glob(args.pattern as string, cfg.search),
    grep: async (args) => grep(args.pattern as string, args.path as string | undefined, cfg.search),
  };
```

Move the `toolHandlers` object inside the function body (it's now closure-captured over `cfg`). The rest of `executeTool` stays the same.

`formatToolCall` does not need changes.

---

## Step 6: Modify `src/llm/prompts.ts`

**No structural changes needed.** The file already exports `SYSTEM_PROMPT` and `tools` as named exports. These become the defaults consumed by `src/agent/config.ts`.

Leave this file exactly as-is.

---

## Step 7: Modify `src/llm/client.ts`

**Current code** has a hardcoded default config and a module-level singleton:

```ts
const DEFAULT_CONFIG: OllamaClientConfig = {
  baseUrl: "http://localhost:11434",
  model: "nemotron-3-nano:30b",
};
// ...
export const client = new OllamaClient();
```

**Changes:**

1. The `OllamaClient` class already accepts `Partial<OllamaClientConfig>` in its constructor — no class changes needed.

2. Change the module-level singleton to a factory function so `runAgent` can create a client from config:

Keep the existing `export const client = new OllamaClient();` (used by `src/index.ts` for connection checking), but also add:

```ts
export function createClient(config: { baseUrl: string; model: string }): OllamaClient {
  return new OllamaClient(config);
}
```

Add this right after the `export const client = new OllamaClient();` line.

---

## Step 8: Modify `src/agent/loop.ts` (the big one)

This is the central change. `runAgent` must accept an optional `AgentConfig` and thread it through.

**Current signature:**

```ts
import { client } from "../llm/client.ts";
import { SYSTEM_PROMPT, tools } from "../llm/prompts.ts";
import { executeTool, formatToolCall } from "../tools/index.ts";

const MAX_ITERATIONS = 10;

export async function runAgent(
  userMessage: string,
  history: Message[],
  callbacks: AgentCallbacks
): Promise<Message[]> {
```

**New signature and imports:**

```ts
import { client as defaultClient, createClient } from "../llm/client.ts";
import type { OllamaClient } from "../llm/client.ts";
import { executeTool, formatToolCall } from "../tools/index.ts";
import type { AgentConfig } from "./config.ts";
import { defaultAgentConfig } from "./config.ts";

export async function runAgent(
  userMessage: string,
  history: Message[],
  callbacks: AgentCallbacks,
  config?: AgentConfig
): Promise<Message[]> {
  const cfg = config ?? defaultAgentConfig();
  const llmClient = config
    ? createClient(cfg.llm)
    : defaultClient;
```

Remove the `import { SYSTEM_PROMPT, tools } from "../llm/prompts.ts";` line — those now come from `cfg`.

Remove the `const MAX_ITERATIONS = 10;` line.

Then apply these replacements inside `runAgent`:

1. `SYSTEM_PROMPT` → `cfg.systemPrompt`
2. `MAX_ITERATIONS` → `cfg.loop.maxIterations`
3. Every call to `executeTool(toolCall.function.name, argsJson)` → `executeTool(toolCall.function.name, argsJson, cfg)`

The `streamResponse` helper function also needs the client and tools passed in. Change its signature:

**Current:**

```ts
async function streamResponse(
  messages: Message[],
  callbacks: AgentCallbacks
): Promise<{ content: string; toolCalls: ToolCall[] }> {
```

**New:**

```ts
async function streamResponse(
  messages: Message[],
  callbacks: AgentCallbacks,
  llmClient: OllamaClient,
  tools: Tool[]
): Promise<{ content: string; toolCalls: ToolCall[] }> {
```

Inside `streamResponse`, replace:
- `client.chat(messages, tools)` → `llmClient.chat(messages, tools)`
- `client.chatStream(messages, tools)` → `llmClient.chatStream(messages, tools)`

(The `tools` parameter shadows the old import — which we already removed.)

Where `runAgent` calls `streamResponse`, pass the new args:

```ts
const { content, toolCalls } = await streamResponse(messages, callbacks, llmClient, cfg.tools);
```

Also import `Tool` type:

```ts
import type { Message, ToolCall, OllamaStreamChunk, Tool, OllamaClient } from "../llm/client.ts";
```

Wait — `OllamaClient` is a class, not just a type. Since we need it as a value for `instanceof` or constructor, but here we only use it as a parameter type, import it as a type:

```ts
import type { Message, ToolCall, OllamaStreamChunk, Tool } from "../llm/client.ts";
import { client as defaultClient, createClient, type OllamaClient } from "../llm/client.ts";
```

Actually, since `OllamaClient` is used only as a type annotation for the parameter, and TypeScript has `verbatimModuleSyntax: true` in tsconfig, you need the `type` keyword. But `createClient` returns `OllamaClient` so the type is already inferred. Simplest approach:

```ts
import { client as defaultClient, createClient } from "../llm/client.ts";
```

And for `streamResponse`, just type the param as `typeof defaultClient`:

```ts
async function streamResponse(
  messages: Message[],
  callbacks: AgentCallbacks,
  llmClient: typeof defaultClient,
  tools: import("../llm/client.ts").Tool[]
): Promise<{ content: string; toolCalls: ToolCall[] }> {
```

Or even simpler — since `verbatimModuleSyntax` is on, use inline `import type`:

```ts
import type { Message, ToolCall, OllamaStreamChunk, Tool } from "../llm/client.ts";
import { client as defaultClient, createClient } from "../llm/client.ts";
```

The `type` import is fine for types, value import for `createClient` and `defaultClient`.

---

## Step 9: Modify `src/index.ts`

**Minimal change.** The entry point doesn't need to construct a config — it uses defaults. But we pass `undefined` for config (which triggers defaults inside `runAgent`).

The only change: `runAgent` now has a 4th parameter. Since it's optional and defaults to `undefined`, the existing call:

```ts
history = await runAgent(userInput, history, callbacks);
```

...still works with no changes. **No modification needed to `src/index.ts`.**

However, to make it explicit and to show how a user would override config, optionally add:

```ts
import { defaultAgentConfig } from "./agent/config.ts";
```

And construct the config at startup if env vars are set:

```ts
// After connection check, before REPL loop:
const config = defaultAgentConfig();
// Allow env var overrides
if (process.env.NEMOTRON_MODEL) config.llm.model = process.env.NEMOTRON_MODEL;
if (process.env.NEMOTRON_MAX_ITERATIONS) config.loop.maxIterations = parseInt(process.env.NEMOTRON_MAX_ITERATIONS);
if (process.env.NEMOTRON_TIMEOUT) config.bash.timeoutMs = parseInt(process.env.NEMOTRON_TIMEOUT);

// Then in the REPL:
history = await runAgent(userInput, history, callbacks, config);
```

This is optional but nice for manual testing. The critical thing is that `runAgent` accepts the config.

---

## Step 10: Export config from package

Add to `package.json` exports (optional, for programmatic use by harness-improver):

```json
"exports": {
  ".": "./src/index.ts",
  "./config": "./src/agent/config.ts",
  "./agent": "./src/agent/loop.ts"
}
```

---

## Verification Checklist

After all changes, verify:

1. **`bun run src/index.ts`** — starts normally, agent works exactly as before (all defaults kick in)
2. **`bun run src/index.ts` with `NEMOTRON_MODEL=some-model`** — uses the env var
3. **Programmatic use works:**

```ts
import { runAgent } from "./src/agent/loop.ts";
import { defaultAgentConfig } from "./src/agent/config.ts";

const config = defaultAgentConfig();
config.systemPrompt += "\nAlways use grep before reading files.";
config.loop.maxIterations = 5;
config.bash.timeoutMs = 10_000;

const history = await runAgent("Fix the bug", [], callbacks, config);
```

4. **No `import` of hardcoded values from prompts.ts in loop.ts** — they only flow through config now
5. **No top-level constants** for `MAX_ITERATIONS`, `TIMEOUT_MS`, `MAX_OUTPUT`, `MAX_FILE_SIZE`, `MAX_RESULTS` — all replaced by config params
6. **`bun run typecheck`** (or `tsc --noEmit`) passes with zero errors

---

## Summary of Changes

| File | Action | Size |
|---|---|---|
| `src/agent/config.ts` | CREATE | ~60 lines |
| `src/tools/bash.ts` | EDIT | ~5 line changes |
| `src/tools/file.ts` | EDIT | ~4 line changes |
| `src/tools/search.ts` | EDIT | ~8 line changes |
| `src/tools/index.ts` | EDIT | ~10 line changes |
| `src/llm/prompts.ts` | NO CHANGE | — |
| `src/llm/client.ts` | EDIT | ~3 lines added |
| `src/agent/loop.ts` | EDIT | ~15 line changes |
| `src/index.ts` | EDIT (optional) | ~5 lines added |

Total: ~1 new file, ~7 files edited, ~50 lines changed. Pure refactor, zero behavior change.
