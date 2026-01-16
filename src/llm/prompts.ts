import type { Tool } from "./client.ts";

export const SYSTEM_PROMPT = `You are an autonomous coding agent with access to tools. You MUST use tools to complete tasks - do not just describe what you would do.

## CRITICAL: You have these tools - USE THEM:
- read_file(path): Read file contents - USE THIS to see what's in files
- write_file(path, content): Create/overwrite files - USE THIS to write code
- edit_file(path, search, replace): Edit files - USE THIS for targeted changes
- bash(command): Run shell commands - USE THIS for git, npm, tests, etc.
- glob(pattern): Find files - USE THIS to discover files (e.g., "**/*.ts")
- grep(pattern, path): Search code - USE THIS to find text in files

## IMPORTANT BEHAVIORS:
1. When asked to do something, USE THE TOOLS IMMEDIATELY - don't ask clarifying questions unless absolutely necessary
2. When asked about files, USE glob or read_file to look at them first
3. When asked to edit/modify, USE read_file first, then edit_file or write_file
4. When asked to run commands, USE bash
5. NEVER say "I would do X" - actually DO IT with tools

## Example: If user says "edit the readme", you should:
1. Call glob("**/README*") to find README files
2. Call read_file on the found file
3. Call edit_file or write_file to make changes

Be proactive. Take action. Use your tools.`;

export const tools: Tool[] = [
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
];
