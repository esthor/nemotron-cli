import { test, expect, describe } from "bun:test";

// Test the SSRF protection logic
// We can't directly import the private isBlockedHost function, but we can test webFetch behavior

describe("SSRF Protection", () => {
  // Since isBlockedHost is not exported, we test the webFetch function directly
  // These tests verify that blocked hosts are rejected

  test("blocks localhost", async () => {
    const { webFetch } = await import("../../src/tools/web.ts");

    await expect(webFetch("http://localhost/test")).rejects.toThrow(
      /Blocked.*localhost/i
    );
  });

  test("blocks 127.0.0.1", async () => {
    const { webFetch } = await import("../../src/tools/web.ts");

    await expect(webFetch("http://127.0.0.1/test")).rejects.toThrow(
      /Blocked.*127\.0\.0\.1/i
    );
  });

  test("blocks private IP ranges (10.x.x.x)", async () => {
    const { webFetch } = await import("../../src/tools/web.ts");

    await expect(webFetch("http://10.0.0.1/test")).rejects.toThrow(/Blocked/i);
  });

  test("blocks private IP ranges (192.168.x.x)", async () => {
    const { webFetch } = await import("../../src/tools/web.ts");

    await expect(webFetch("http://192.168.1.1/test")).rejects.toThrow(
      /Blocked/i
    );
  });

  test("blocks private IP ranges (172.16-31.x.x)", async () => {
    const { webFetch } = await import("../../src/tools/web.ts");

    await expect(webFetch("http://172.16.0.1/test")).rejects.toThrow(/Blocked/i);
    await expect(webFetch("http://172.31.255.255/test")).rejects.toThrow(
      /Blocked/i
    );
  });

  test("blocks AWS metadata endpoint", async () => {
    const { webFetch } = await import("../../src/tools/web.ts");

    await expect(webFetch("http://169.254.169.254/latest/meta-data")).rejects.toThrow(
      /Blocked/i
    );
  });

  test("blocks IPv6 loopback", async () => {
    const { webFetch } = await import("../../src/tools/web.ts");

    await expect(webFetch("http://[::1]/test")).rejects.toThrow(/Blocked/i);
  });

  test("rejects invalid URLs", async () => {
    const { webFetch } = await import("../../src/tools/web.ts");

    await expect(webFetch("not-a-url")).rejects.toThrow(/Invalid URL/i);
    await expect(webFetch("ftp://example.com")).rejects.toThrow(/Invalid URL/i);
  });
});
