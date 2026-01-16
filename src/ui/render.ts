/**
 * Markdown rendering and output formatting
 */

import { marked } from "marked";
import TerminalRenderer from "marked-terminal";
import { highlight } from "cli-highlight";
import { colorize } from "./spinner.ts";

// Configure marked with terminal renderer
const terminalRenderer = new TerminalRenderer({
  code: (code: string, lang?: string) => {
    try {
      return highlight(code, { language: lang || "plaintext" });
    } catch {
      return code;
    }
  },
});

marked.setOptions({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderer: terminalRenderer as any,
});

export function renderMarkdown(text: string): string {
  try {
    return marked.parse(text) as string;
  } catch {
    return text;
  }
}

export function renderToolCall(name: string, args: string): void {
  let argsDisplay = "";
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>;
    const entries = Object.entries(parsed).map(([k, v]) => {
      let val = typeof v === "string" ? v : JSON.stringify(v);
      if (val.length > 60) val = val.slice(0, 60) + "...";
      return `${colorize(k, "cyan")}: ${val}`;
    });
    argsDisplay = entries.join(", ");
  } catch {
    argsDisplay = args;
  }

  console.log(`\n${colorize("⚡", "yellow")} ${colorize(name, "bold")}(${argsDisplay})`);
}

export function renderToolResult(
  name: string,
  result: string,
  success: boolean
): void {
  const icon = success ? colorize("✓", "green") : colorize("✗", "red");
  const preview = result.length > 200 ? result.slice(0, 200) + "..." : result;

  console.log(`${icon} ${colorize(name, "dim")} completed`);

  if (!success || result.includes("Error")) {
    console.log(colorize(preview, "dim"));
  }
}

export function renderError(error: Error): void {
  console.log(`\n${colorize("Error:", "red")} ${error.message}`);
}

export function renderWelcome(): void {
  console.log(`
${colorize("╭────────────────────────────────────────╮", "cyan")}
${colorize("│", "cyan")}  ${colorize("Nemotron CLI", "bold")}                          ${colorize("│", "cyan")}
${colorize("│", "cyan")}  ${colorize("Powered by NVIDIA Nemotron 3 Nano", "dim")}     ${colorize("│", "cyan")}
${colorize("╰────────────────────────────────────────╯", "cyan")}

${colorize("Commands:", "dim")}
  ${colorize("exit", "cyan")}  - Quit the CLI
  ${colorize("clear", "cyan")} - Clear conversation history

`);
}

export function renderConnectionError(error: string): void {
  console.log(`
${colorize("Connection Error", "red")}

${error}

${colorize("Make sure Ollama is running:", "dim")}
  ${colorize("ollama serve", "cyan")}

${colorize("And the model is downloaded:", "dim")}
  ${colorize("ollama pull nemotron-3-nano:30b", "cyan")}
`);
}

// Get terminal width, default to 80 if not available
function getTerminalWidth(): number {
  return process.stdout.columns || 80;
}

// Stream buffer for incremental rendering with word wrapping
export class StreamBuffer {
  private buffer = "";
  private currentCol = 0;
  private maxWidth: number;

  constructor() {
    this.maxWidth = getTerminalWidth() - 2; // Leave some margin
  }

  append(token: string): void {
    this.buffer += token;

    // Process character by character for proper wrapping
    for (const char of token) {
      if (char === "\n") {
        process.stdout.write("\n");
        this.currentCol = 0;
      } else if (this.currentCol >= this.maxWidth) {
        // Wrap at max width
        process.stdout.write("\n");
        this.currentCol = 0;
        if (char !== " ") {
          process.stdout.write(char);
          this.currentCol++;
        }
      } else {
        process.stdout.write(char);
        this.currentCol++;
      }
    }
  }

  flush(): string {
    const content = this.buffer;
    this.buffer = "";
    this.currentCol = 0;
    return content;
  }

  newline(): void {
    if (this.buffer || this.currentCol > 0) {
      console.log();
      this.currentCol = 0;
    }
  }
}
