import { test, expect, describe } from "bun:test";

// Test the JSON extraction logic
// We need to replicate the extractFirstJsonObject function for testing since it's not exported

function extractFirstJsonObject(content: string): string | null {
  const startIdx = content.indexOf("{");
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIdx; i < content.length; i++) {
    const char = content[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === "\\" && inString) {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === "{") depth++;
      else if (char === "}") {
        depth--;
        if (depth === 0) {
          return content.slice(startIdx, i + 1);
        }
      }
    }
  }
  return null;
}

describe("extractFirstJsonObject", () => {
  test("extracts simple JSON object", () => {
    const content = 'Some text {"type": "explore", "summary": "test"} more text';
    const result = extractFirstJsonObject(content);

    expect(result).toBe('{"type": "explore", "summary": "test"}');
    expect(JSON.parse(result!)).toEqual({ type: "explore", summary: "test" });
  });

  test("extracts nested JSON correctly", () => {
    const content = `Here is the result: {"type": "plan", "steps": [{"id": 1, "nested": {"deep": true}}], "summary": "done"} end`;
    const result = extractFirstJsonObject(content);

    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.type).toBe("plan");
    expect(parsed.steps[0].nested.deep).toBe(true);
  });

  test("handles braces inside strings", () => {
    const content = '{"message": "Hello {world}", "type": "test"}';
    const result = extractFirstJsonObject(content);

    expect(result).toBe('{"message": "Hello {world}", "type": "test"}');
    const parsed = JSON.parse(result!);
    expect(parsed.message).toBe("Hello {world}");
  });

  test("handles escaped quotes inside strings", () => {
    const content = '{"message": "Say \\"hello\\"", "type": "test"}';
    const result = extractFirstJsonObject(content);

    expect(result).toBe('{"message": "Say \\"hello\\"", "type": "test"}');
    const parsed = JSON.parse(result!);
    expect(parsed.message).toBe('Say "hello"');
  });

  test("handles multiple JSON objects - returns first only", () => {
    const content = 'First: {"a": 1} Second: {"b": 2}';
    const result = extractFirstJsonObject(content);

    expect(result).toBe('{"a": 1}');
  });

  test("returns null when no JSON object found", () => {
    const content = "No JSON here, just plain text";
    const result = extractFirstJsonObject(content);

    expect(result).toBeNull();
  });

  test("returns null for unclosed JSON", () => {
    const content = 'Incomplete: {"type": "test"';
    const result = extractFirstJsonObject(content);

    expect(result).toBeNull();
  });

  test("handles complex nested structures", () => {
    const content = `
    Result: {
      "type": "execute",
      "filesCreated": ["a.ts", "b.ts"],
      "filesModified": [],
      "commandsRun": [
        {"command": "bun test", "success": true, "output": "passed"}
      ],
      "summary": "Created files"
    }
    `;
    const result = extractFirstJsonObject(content);

    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.type).toBe("execute");
    expect(parsed.filesCreated).toEqual(["a.ts", "b.ts"]);
    expect(parsed.commandsRun[0].success).toBe(true);
  });
});

describe("Message Pruning", () => {
  // Test the pruning logic
  function pruneMessages(
    messages: { role: string; content: string }[],
    maxMessages: number
  ): void {
    if (messages.length <= maxMessages) return;

    const systemPrompt = messages[0];
    const userPrompt = messages[1];
    const keepCount = maxMessages - 2;
    const recentMessages = messages.slice(-keepCount);

    messages.length = 0;
    messages.push(systemPrompt, userPrompt, ...recentMessages);
  }

  test("does not prune when under limit", () => {
    const messages = [
      { role: "system", content: "sys" },
      { role: "user", content: "user" },
      { role: "assistant", content: "response" },
    ];

    pruneMessages(messages, 50);

    expect(messages).toHaveLength(3);
  });

  test("prunes to max keeping system and user prompts", () => {
    const messages = [
      { role: "system", content: "sys" },
      { role: "user", content: "user" },
      { role: "assistant", content: "old1" },
      { role: "tool", content: "old2" },
      { role: "assistant", content: "old3" },
      { role: "tool", content: "old4" },
      { role: "assistant", content: "recent1" },
      { role: "tool", content: "recent2" },
    ];

    pruneMessages(messages, 6);

    expect(messages).toHaveLength(6);
    expect(messages[0].content).toBe("sys");
    expect(messages[1].content).toBe("user");
    expect(messages[2].content).toBe("old3");
    expect(messages[5].content).toBe("recent2");
  });
});
