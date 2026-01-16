#!/usr/bin/env bun
/**
 * Nemotron CLI - A coding agent powered by NVIDIA Nemotron 3 Nano
 */

import * as p from "@clack/prompts";
import type { Message } from "./llm/client.ts";
import { client } from "./llm/client.ts";
import { runAgent, type AgentCallbacks } from "./agent/loop.ts";
import { Spinner, colorize } from "./ui/spinner.ts";
import {
  renderWelcome,
  renderConnectionError,
  renderToolCall,
  renderToolResult,
  renderError,
  StreamBuffer,
} from "./ui/render.ts";

async function main() {
  // Parse CLI args
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
${colorize("Nemotron CLI", "bold")} - A coding agent powered by NVIDIA Nemotron 3 Nano

${colorize("Usage:", "dim")}
  nemotron [options]

${colorize("Options:", "dim")}
  --help, -h     Show this help message
  --version, -v  Show version

${colorize("Requirements:", "dim")}
  - Ollama running (ollama serve)
  - Model downloaded (ollama pull nemotron-3-nano:30b)
`);
    process.exit(0);
  }

  if (args.includes("--version") || args.includes("-v")) {
    console.log("nemotron-cli v0.1.0");
    process.exit(0);
  }

  // Check Ollama connection
  const spinner = new Spinner("Connecting to Ollama...");
  spinner.start();

  const connection = await client.checkConnection();

  spinner.stop();

  if (!connection.ok) {
    renderConnectionError(connection.error || "Unknown error");
    process.exit(1);
  }

  // Show welcome
  renderWelcome();

  // Conversation history
  let history: Message[] = [];

  // REPL loop
  while (true) {
    const input = await p.text({
      message: colorize("nemotron", "cyan"),
      placeholder: "Ask me anything about code...",
    });

    if (p.isCancel(input)) {
      console.log(colorize("\nGoodbye!", "dim"));
      process.exit(0);
    }

    const userInput = (input as string).trim();

    if (!userInput) continue;

    // Handle commands
    if (userInput.toLowerCase() === "exit") {
      console.log(colorize("\nGoodbye!", "dim"));
      process.exit(0);
    }

    if (userInput.toLowerCase() === "clear") {
      history = [];
      console.clear();
      renderWelcome();
      continue;
    }

    // Run agent
    const streamBuffer = new StreamBuffer();
    const thinkingSpinner = new Spinner("Thinking...");
    let isStreaming = false;

    const callbacks: AgentCallbacks = {
      onThinking: () => {
        if (!isStreaming) {
          thinkingSpinner.start();
        }
      },

      onToken: (token) => {
        if (!isStreaming) {
          thinkingSpinner.stop();
          isStreaming = true;
          console.log(); // New line before response
        }
        streamBuffer.append(token);
      },

      onToolCall: (name, args) => {
        if (isStreaming) {
          streamBuffer.newline();
          isStreaming = false;
        }
        thinkingSpinner.stop();
        renderToolCall(name, args);
        thinkingSpinner.update(`Running ${name}...`);
        thinkingSpinner.start();
      },

      onToolResult: (name, result, success) => {
        thinkingSpinner.stop();
        renderToolResult(name, result, success);
      },

      onComplete: () => {
        thinkingSpinner.stop();
        if (isStreaming) {
          console.log("\n"); // Extra spacing after response
        }
      },

      onError: (error) => {
        thinkingSpinner.stop();
        renderError(error);
      },
    };

    try {
      history = await runAgent(userInput, history, callbacks);
    } catch (error) {
      thinkingSpinner.stop();
      renderError(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

// Run
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
