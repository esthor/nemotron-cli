#!/usr/bin/env bun
/**
 * Nemotron CLI - A coding agent powered by NVIDIA Nemotron 3 Nano
 * With sub-agent orchestration capabilities
 */

import * as p from "@clack/prompts";
import type { Message } from "./llm/client.ts";
import { client, initClient } from "./llm/client.ts";
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
import { setSpawnAgentHandler } from "./tools/index.ts";
import { ParallelAgentExecutor } from "./agents/parallel.ts";
import { AgentRenderer } from "./ui/agents.ts";
import type { AgentType } from "./agents/types.ts";

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
  --cloud        Use cloud-routed model (default: local)

${colorize("Requirements:", "dim")}
  - Ollama running (ollama serve)
  - Model downloaded (ollama pull nemotron-3-nano:30b)

${colorize("Sub-Agents:", "dim")}
  The orchestrator can delegate to specialized sub-agents:
  - explore: Fast codebase exploration
  - research: Web search and documentation
  - plan: Architectural planning
  - execute: Code implementation
  - refactor: Code quality improvements
  - assess: Business value assessment
  - verify: Testing and validation
`);
    process.exit(0);
  }

  if (args.includes("--version") || args.includes("-v")) {
    console.log("nemotron-cli v0.2.0");
    process.exit(0);
  }

  // Handle --cloud flag: use cloud-routed model variant
  const useCloud = args.includes("--cloud");
  if (useCloud) {
    initClient({ model: "nemotron-3-nano:30b-cloud" });
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

  // Initialize agent renderer and executor
  const agentRenderer = new AgentRenderer();
  const agentExecutor = new ParallelAgentExecutor({
    onAgentStart: (taskId, type) => agentRenderer.startAgent(taskId, type),
    onAgentProgress: (taskId, msg) => agentRenderer.updateProgress(taskId, msg),
    onAgentToolCall: (taskId, tool, args) =>
      agentRenderer.showToolCall(taskId, tool, args),
    onAgentComplete: (taskId, result) =>
      agentRenderer.completeAgent(taskId, result),
    onAgentError: (taskId, error) => agentRenderer.failAgent(taskId, error),
  });

  // Set up spawn_agent handler to use our executor
  setSpawnAgentHandler(async (agentType: AgentType, prompt: string) => {
    return agentExecutor.spawn(agentType, prompt);
  });

  // Show welcome
  renderWelcome();
  console.log(
    colorize(
      `  Model: ${client.modelName} (${useCloud ? "cloud" : "local"})`,
      "dim"
    )
  );
  console.log(
    colorize(
      "  Sub-agents enabled: explore, research, plan, execute, refactor, assess, verify\n",
      "dim"
    )
  );

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
      console.log(
        colorize(
          "  Sub-agents enabled: explore, research, plan, execute, refactor, assess, verify\n",
          "dim"
        )
      );
      continue;
    }

    if (userInput.toLowerCase() === "agents") {
      const status = agentExecutor.getStatus();
      if (status.length === 0) {
        console.log(colorize("\nNo active agents.\n", "dim"));
      } else {
        console.log(colorize("\nActive agents:", "cyan"));
        for (const task of status) {
          const elapsed = task.startedAt
            ? ((Date.now() - task.startedAt) / 1000).toFixed(1)
            : "?";
          console.log(
            `  ${task.agentType} [${task.id.slice(0, 5)}] - ${task.status} (${elapsed}s)`
          );
        }
        console.log();
      }
      continue;
    }

    // Run agent
    const streamBuffer = new StreamBuffer();
    const thinkingSpinner = new Spinner("Thinking...");
    let isStreaming = false;

    const callbacks: AgentCallbacks = {
      onThinking: () => {
        if (!isStreaming && !agentRenderer.isRunning()) {
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

        // spawn_agent is handled by the agent renderer
        if (name !== "spawn_agent") {
          renderToolCall(name, args);
          thinkingSpinner.update(`Running ${name}...`);
          thinkingSpinner.start();
        }
      },

      onToolResult: (name, result, success) => {
        thinkingSpinner.stop();
        // spawn_agent results are rendered by agent renderer
        if (name !== "spawn_agent") {
          renderToolResult(name, result, success);
        }
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
