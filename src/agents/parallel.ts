/**
 * Parallel Agent Executor
 * Manages concurrent agent execution with multiplexed output
 */

import type {
  AgentType,
  AgentResult,
  SubAgentTask,
  SubAgentCallbacks,
} from "./types.ts";
import { generateTaskId } from "./types.ts";
import { runSubAgent } from "./runner.ts";

export interface ParallelAgentCallbacks {
  onAgentStart: (taskId: string, agentType: AgentType) => void;
  onAgentProgress: (taskId: string, message: string) => void;
  onAgentToolCall: (taskId: string, tool: string, args: string) => void;
  onAgentComplete: (taskId: string, result: AgentResult) => void;
  onAgentError: (taskId: string, error: Error) => void;
}

/** Result of spawning multiple agents */
export interface SpawnAllResult {
  successes: Map<string, AgentResult>;
  failures: Map<string, Error>;
}

export class ParallelAgentExecutor {
  private activeTasks: Map<string, SubAgentTask> = new Map();
  private callbacks: ParallelAgentCallbacks;

  constructor(callbacks: ParallelAgentCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Generate a unique task ID that doesn't collide with active tasks
   */
  private generateUniqueTaskId(maxAttempts = 100): string {
    for (let i = 0; i < maxAttempts; i++) {
      const taskId = generateTaskId();
      if (!this.activeTasks.has(taskId)) {
        return taskId;
      }
    }
    throw new Error("Failed to generate unique task ID after maximum attempts");
  }

  /**
   * Spawn multiple agents in parallel
   * Returns when ALL agents complete, with both successes and failures
   */
  async spawnAll(
    tasks: { agentType: AgentType; prompt: string }[]
  ): Promise<SpawnAllResult> {
    const taskIds = tasks.map((t) => {
      const taskId = this.generateUniqueTaskId();
      const task: SubAgentTask = {
        id: taskId,
        agentType: t.agentType,
        prompt: t.prompt,
        status: "pending",
        startedAt: Date.now(),
      };
      this.activeTasks.set(taskId, task);
      return taskId;
    });

    // Run all concurrently
    const promises = taskIds.map((id) => this.executeTask(id));
    const settledResults = await Promise.allSettled(promises);

    // Aggregate results, tracking both successes and failures
    const successes = new Map<string, AgentResult>();
    const failures = new Map<string, Error>();

    settledResults.forEach((settled, index) => {
      const taskId = taskIds[index];
      if (taskId) {
        if (settled.status === "fulfilled") {
          successes.set(taskId, settled.value);
        } else {
          failures.set(
            taskId,
            settled.reason instanceof Error
              ? settled.reason
              : new Error(String(settled.reason))
          );
        }
      }
    });

    return { successes, failures };
  }

  /**
   * Spawn a single agent (can run while others are active)
   */
  async spawn(agentType: AgentType, prompt: string): Promise<AgentResult> {
    const taskId = generateTaskId();
    const task: SubAgentTask = {
      id: taskId,
      agentType,
      prompt,
      status: "pending",
      startedAt: Date.now(),
    };
    this.activeTasks.set(taskId, task);
    return this.executeTask(taskId);
  }

  /**
   * Check if any agents are currently running
   */
  isRunning(): boolean {
    return Array.from(this.activeTasks.values()).some(
      (t) => t.status === "running"
    );
  }

  /**
   * Get status of all active tasks
   */
  getStatus(): SubAgentTask[] {
    return Array.from(this.activeTasks.values());
  }

  /**
   * Get a specific task by ID
   */
  getTask(taskId: string): SubAgentTask | undefined {
    return this.activeTasks.get(taskId);
  }

  /**
   * Clear completed tasks from memory
   */
  clearCompleted(): void {
    for (const [id, task] of this.activeTasks) {
      if (task.status === "completed" || task.status === "failed") {
        this.activeTasks.delete(id);
      }
    }
  }

  /**
   * Execute a single task
   */
  private async executeTask(taskId: string): Promise<AgentResult> {
    const task = this.activeTasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    task.status = "running";
    this.callbacks.onAgentStart(taskId, task.agentType);

    // Create callbacks that route to the parallel callbacks with taskId
    const subCallbacks: SubAgentCallbacks = {
      onProgress: (msg) => this.callbacks.onAgentProgress(taskId, msg),
      onToolCall: (tool, args) =>
        this.callbacks.onAgentToolCall(taskId, tool, args),
    };

    try {
      const result = await runSubAgent(task, subCallbacks);

      task.status = "completed";
      task.result = result;
      task.completedAt = Date.now();

      this.callbacks.onAgentComplete(taskId, result);
      return result;
    } catch (error) {
      task.status = "failed";
      task.error = error instanceof Error ? error.message : String(error);
      task.completedAt = Date.now();

      const err = error instanceof Error ? error : new Error(String(error));
      this.callbacks.onAgentError(taskId, err);
      throw err;
    }
  }
}

/**
 * Create a simple executor with console logging (for testing)
 */
export function createSimpleExecutor(): ParallelAgentExecutor {
  return new ParallelAgentExecutor({
    onAgentStart: (taskId, type) =>
      console.log(`[${taskId}] Starting ${type} agent...`),
    onAgentProgress: (taskId, msg) => console.log(`[${taskId}] ${msg}`),
    onAgentToolCall: (taskId, tool, args) =>
      console.log(`[${taskId}] Tool: ${tool}(${args.slice(0, 50)}...)`),
    onAgentComplete: (taskId, result) =>
      console.log(`[${taskId}] Complete: ${result.summary}`),
    onAgentError: (taskId, error) =>
      console.error(`[${taskId}] Error: ${error.message}`),
  });
}
