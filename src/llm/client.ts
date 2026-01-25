/**
 * Ollama LLM Client
 * Uses native Ollama API for chat completions with streaming and tool support
 */

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface Tool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}

// Native Ollama streaming response format
export interface OllamaStreamChunk {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
    tool_calls?: {
      function: {
        name: string;
        arguments: Record<string, unknown>;
      };
    }[];
  };
  done: boolean;
  done_reason?: string;
}

export interface OllamaClientConfig {
  baseUrl: string;
  model: string;
}

const DEFAULT_CONFIG: OllamaClientConfig = {
  baseUrl: "http://localhost:11434",
  model: "nemotron-3-nano:30b",
};

export class OllamaClient {
  private config: OllamaClientConfig;

  constructor(config: Partial<OllamaClientConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if Ollama is running and the model is available
   */
  async checkConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      // Use native Ollama tags endpoint
      const response = await fetch(`${this.config.baseUrl}/api/tags`);
      if (!response.ok) {
        return { ok: false, error: "Ollama server not responding" };
      }

      const data = (await response.json()) as { models: { name: string }[] };
      const models = data.models?.map((m) => m.name) || [];

      if (!models.some((m) => m.includes("nemotron"))) {
        return {
          ok: false,
          error: `Model not found. Run: ollama pull ${this.config.model}`,
        };
      }

      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: "Cannot connect to Ollama. Is it running? Try: ollama serve",
      };
    }
  }

  /**
   * Stream chat completion responses using native Ollama API
   */
  async *chatStream(
    messages: Message[],
    tools?: Tool[]
  ): AsyncGenerator<OllamaStreamChunk> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.tool_calls && { tool_calls: m.tool_calls }),
      })),
      stream: true,
    };

    // Only include tools if provided and non-empty
    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    const response = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama error: ${response.status} - ${text}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const json = JSON.parse(trimmed) as OllamaStreamChunk;
          yield json;
        } catch {
          // Skip malformed JSON
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      try {
        const json = JSON.parse(buffer.trim()) as OllamaStreamChunk;
        yield json;
      } catch {
        // Skip malformed JSON
      }
    }
  }

  /**
   * Non-streaming chat completion
   */
  async chat(
    messages: Message[],
    tools?: Tool[]
  ): Promise<{ content: string; toolCalls?: ToolCall[] }> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: false,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    const response = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama error: ${response.status} - ${text}`);
    }

    const data = (await response.json()) as {
      message: {
        content: string;
        tool_calls?: {
          function: { name: string; arguments: Record<string, unknown> };
        }[];
      };
    };

    const toolCalls = data.message.tool_calls?.map((tc, i) => ({
      id: `call_${i}`,
      type: "function" as const,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    }));

    return {
      content: data.message.content || "",
      toolCalls,
    };
  }

  get modelName(): string {
    return this.config.model;
  }
}

export let client = new OllamaClient();

/**
 * Reinitializes the exported Ollama client with the provided configuration.
 *
 * Replaces the module-level `client` instance by constructing a new `OllamaClient`
 * using the given partial configuration merged with defaults.
 *
 * @param config - Partial client configuration used to configure the new `OllamaClient`
 */
export function initClient(config: Partial<OllamaClientConfig>): void {
  client = new OllamaClient(config);
}