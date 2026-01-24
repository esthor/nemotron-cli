/**
 * Agent TUI Renderer
 * Handles parallel agent display with multiplexed output
 */

import type { AgentType, SubAgentTask, AgentResult } from "../agents/types.ts";
import { colorize, colors } from "./spinner.ts";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// Agent styles with icons and colors
const AGENT_STYLES: Record<AgentType, { icon: string; color: keyof typeof colors }> = {
  explore: { icon: "🔍", color: "cyan" },
  research: { icon: "📚", color: "magenta" },
  plan: { icon: "📋", color: "yellow" },
  execute: { icon: "⚡", color: "green" },
  refactor: { icon: "🔧", color: "cyan" },
  assess: { icon: "📊", color: "gray" },
  verify: { icon: "✅", color: "green" },
};

export class AgentRenderer {
  private spinnerIndex = 0;
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;
  private activeAgents: Map<string, { type: AgentType; status: string; startTime: number }> = new Map();

  /**
   * Start tracking a new agent
   */
  startAgent(taskId: string, agentType: AgentType): void {
    const style = AGENT_STYLES[agentType];
    this.activeAgents.set(taskId, {
      type: agentType,
      status: "Starting...",
      startTime: Date.now(),
    });

    // Print agent start
    const shortId = taskId.slice(0, 5);
    console.log(
      colorize(`\n${style.icon} [${shortId}] Starting ${agentType} agent...`, style.color)
    );

    this.startSpinner();
  }

  /**
   * Update agent progress
   */
  updateProgress(taskId: string, message: string): void {
    const agent = this.activeAgents.get(taskId);
    if (agent) {
      agent.status = message;
    }
  }

  /**
   * Show tool call from agent
   */
  showToolCall(taskId: string, tool: string, args: string): void {
    const agent = this.activeAgents.get(taskId);
    if (!agent) return;

    const style = AGENT_STYLES[agent.type];
    const shortId = taskId.slice(0, 5);

    // Truncate args for display
    const displayArgs = args.length > 60 ? args.slice(0, 60) + "..." : args;

    this.clearSpinnerLine();
    console.log(
      colorize(`  [${shortId}] `, "dim") +
      colorize(`⚡ ${tool}`, style.color) +
      colorize(`(${displayArgs})`, "dim")
    );
    this.renderStatusLine();
  }

  /**
   * Mark agent as complete and show result
   */
  completeAgent(taskId: string, result: AgentResult): void {
    const agent = this.activeAgents.get(taskId);
    if (!agent) return;

    const style = AGENT_STYLES[agent.type];
    const shortId = taskId.slice(0, 5);
    const duration = ((Date.now() - agent.startTime) / 1000).toFixed(1);

    this.clearSpinnerLine();

    // Print completion header
    console.log(
      colorize(`\n${style.icon} [${shortId}] ${agent.type} `, style.color) +
      colorize(`✓`, "green") +
      colorize(` (${duration}s)`, "dim")
    );

    // Print summary
    console.log(colorize(`  ${result.summary}`, "dim"));

    this.activeAgents.delete(taskId);

    if (this.activeAgents.size === 0) {
      this.stopSpinner();
    } else {
      this.renderStatusLine();
    }
  }

  /**
   * Mark agent as failed
   */
  failAgent(taskId: string, error: Error): void {
    const agent = this.activeAgents.get(taskId);
    if (!agent) return;

    const style = AGENT_STYLES[agent.type];
    const shortId = taskId.slice(0, 5);
    const duration = ((Date.now() - agent.startTime) / 1000).toFixed(1);

    this.clearSpinnerLine();

    console.log(
      colorize(`\n${style.icon} [${shortId}] ${agent.type} `, style.color) +
      colorize(`✗`, "red") +
      colorize(` (${duration}s)`, "dim")
    );
    console.log(colorize(`  Error: ${error.message}`, "red"));

    this.activeAgents.delete(taskId);

    if (this.activeAgents.size === 0) {
      this.stopSpinner();
    } else {
      this.renderStatusLine();
    }
  }

  /**
   * Render the status line showing all active agents
   */
  private renderStatusLine(): void {
    if (this.activeAgents.size === 0) return;

    const statuses = Array.from(this.activeAgents.entries())
      .map(([id, agent]) => {
        const style = AGENT_STYLES[agent.type];
        const shortId = id.slice(0, 5);
        const elapsed = ((Date.now() - agent.startTime) / 1000).toFixed(1);
        const frame = SPINNER_FRAMES[this.spinnerIndex];
        return colorize(`${agent.type}[${shortId}] ${frame} ${elapsed}s`, style.color);
      })
      .join(colorize(" │ ", "dim"));

    process.stdout.write(`\r\x1B[K${colorize("Agents: ", "dim")}${statuses}`);
  }

  /**
   * Start the spinner animation
   */
  private startSpinner(): void {
    if (this.spinnerInterval) return;

    process.stdout.write("\x1B[?25l"); // Hide cursor

    this.spinnerInterval = setInterval(() => {
      this.spinnerIndex = (this.spinnerIndex + 1) % SPINNER_FRAMES.length;
      this.renderStatusLine();
    }, 100);
  }

  /**
   * Stop the spinner
   */
  private stopSpinner(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
      this.clearSpinnerLine();
      process.stdout.write("\x1B[?25h"); // Show cursor
    }
  }

  /**
   * Clear the current spinner line
   */
  private clearSpinnerLine(): void {
    process.stdout.write("\r\x1B[K");
  }

  /**
   * Check if any agents are running
   */
  isRunning(): boolean {
    return this.activeAgents.size > 0;
  }

  /**
   * Get count of active agents
   */
  getActiveCount(): number {
    return this.activeAgents.size;
  }
}

/**
 * Format agent result as pretty JSON for display
 */
export function formatAgentResult(result: AgentResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Summarize result for quick display
 */
export function summarizeResult(result: AgentResult): string {
  return result.summary;
}

/**
 * Render a detailed result pane (for verbose output)
 */
export function renderResultPane(taskId: string, agentType: AgentType, result: AgentResult): void {
  const style = AGENT_STYLES[agentType];
  const shortId = taskId.slice(0, 5);

  console.log(colorize(`\n╭─ ${agentType} [${shortId}] Result ─────────────────────────────────────────────╮`, style.color));

  const json = JSON.stringify(result, null, 2);
  const lines = json.split("\n");
  for (const line of lines) {
    console.log(colorize(`│ ${line}`, "dim"));
  }

  console.log(colorize(`╰──────────────────────────────────────────────────────────────────────╯`, style.color));
}
