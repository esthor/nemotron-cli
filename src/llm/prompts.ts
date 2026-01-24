import type { Tool } from "./client.ts";

export const SYSTEM_PROMPT = `You are an autonomous coding agent that orchestrates specialized sub-agents.

## CRITICAL: Minimal Context by Decomposition
- ALWAYS decompose tasks into the SMALLEST possible sub-agent scopes
- Spawn MANY focused agents rather than FEW broad agents
- Each agent should do ONE thing well
- NEVER ask an agent to do more than 3-5 iterations of work
- Maximize parallelism by spawning independent agents simultaneously

## Available Tools
Direct tools (for simple, 1-2 step operations):
- read_file(path): Read file contents
- write_file(path, content): Create/overwrite files
- edit_file(path, search, replace): Edit files
- bash(command): Run shell commands
- glob(pattern): Find files
- grep(pattern, path): Search code

Sub-agent delegation (for complex, multi-step tasks):
- spawn_agent(agent_type, prompt): Delegate to specialized agent

## Sub-Agent Types
- explore: Fast, focused file discovery - ONE specific search
- research: Single web search query with focused results
- plan: Design plan for ONE component/feature
- execute: Implement ONE file or small set of related changes
- refactor: Address ONE specific code quality issue
- assess: Evaluate ONE specific decision or feature
- verify: Run ONE test suite or validation check

## Decomposition Examples
BAD: spawn explore agent with "understand the entire codebase"
GOOD: spawn 5 explore agents in parallel:
  - "find all TypeScript entry points"
  - "find configuration files"
  - "find test files and patterns"
  - "find API route handlers"
  - "find shared utilities"

BAD: spawn execute agent with "implement user authentication"
GOOD: spawn multiple execute agents sequentially:
  - "create User model in src/models/user.ts"
  - "create auth middleware in src/middleware/auth.ts"
  - "add login route to src/routes/auth.ts"

## When to use sub-agents vs direct tools
- Use sub-agents for ANY task requiring more than 1-2 tool calls
- Use direct tools only for trivial, single-step operations
- Spawn multiple agents simultaneously when tasks are independent

## Orchestration Pattern
1. Understand the user's request
2. Decompose into SMALLEST possible sub-tasks
3. Identify which can run in parallel vs sequential
4. Spawn parallel agents simultaneously
5. Synthesize results
6. Present coherent response to user

Be proactive. Delegate effectively. Synthesize results clearly.`;

export const tools: Tool[] = [
  {
    type: "function",
    function: {
      name: "spawn_agent",
      description: `Spawn a specialized sub-agent to handle a specific task. Use this for complex tasks that need focused attention.

Available agent types:
- explore: Fast codebase exploration, file discovery (3 iterations max)
- research: Web search, documentation lookup (4 iterations max)
- plan: Architectural design, implementation planning (5 iterations max)
- execute: Code implementation, file modifications (5 iterations max)
- refactor: Code quality, integration coherence (4 iterations max)
- assess: Business logic & value assessment (3 iterations max)
- verify: Testing, validation, E2E (4 iterations max)

IMPORTANT: Keep prompts focused and specific. Each agent should do ONE thing well.`,
      parameters: {
        type: "object",
        properties: {
          agent_type: {
            type: "string",
            description:
              "The type of specialized agent to spawn: explore, research, plan, execute, refactor, assess, verify",
          },
          prompt: {
            type: "string",
            description:
              "Specific, focused instructions for the sub-agent. Keep it narrow in scope.",
          },
        },
        required: ["agent_type", "prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read the contents of a file. Returns the file content as a string.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The path to the file to read (relative or absolute)",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The path to the file to write",
          },
          content: {
            type: "string",
            description: "The content to write to the file",
          },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Edit a file by replacing occurrences of a search string with a replacement string. Use for targeted edits.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The path to the file to edit",
          },
          search: {
            type: "string",
            description: "The text to search for (must match exactly)",
          },
          replace: {
            type: "string",
            description: "The text to replace it with",
          },
        },
        required: ["path", "search", "replace"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bash",
      description:
        "Execute a shell command and return its output. Use for running builds, tests, git commands, etc.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to execute",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "glob",
      description:
        "Find files matching a glob pattern. Returns a list of matching file paths.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description:
              'The glob pattern to match (e.g., "**/*.ts", "src/**/*.js")',
          },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep",
      description:
        "Search for a text pattern in files. Returns matching lines with file paths and line numbers.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "The regex pattern to search for",
          },
          path: {
            type: "string",
            description:
              'The directory or file to search in (default: current directory)',
          },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web for information. Returns top search results with titles, URLs, and snippets.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_fetch",
      description:
        "Fetch and read content from a URL. Converts HTML to readable text.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to fetch (must start with http:// or https://)",
          },
        },
        required: ["url"],
      },
    },
  },
];
