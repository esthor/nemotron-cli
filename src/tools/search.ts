/**
 * Search tools: glob and grep
 */

import { resolve } from "path";

export interface SearchConfig {
  maxResults: number;
  grepExtensions: string[];
}

const DEFAULTS: SearchConfig = {
  maxResults: 100,
  grepExtensions: ["ts", "js", "tsx", "jsx", "json", "md", "css", "html", "py", "go", "rs"],
};

export async function glob(pattern: string, config: SearchConfig = DEFAULTS): Promise<string> {
  const globber = new Bun.Glob(pattern);
  const matches: string[] = [];

  for await (const file of globber.scan({ cwd: process.cwd(), dot: false })) {
    matches.push(file);
    if (matches.length >= config.maxResults) break;
  }

  if (matches.length === 0) {
    return `No files found matching pattern: ${pattern}`;
  }

  let result = matches.join("\n");

  if (matches.length >= config.maxResults) {
    result += `\n\n[... limited to ${config.maxResults} results ...]`;
  }

  return result;
}

export async function grep(pattern: string, path?: string, config: SearchConfig = DEFAULTS): Promise<string> {
  const searchPath = path ? resolve(path) : process.cwd();

  const proc = Bun.spawn(
    [
      "grep",
      "-rn",
      ...config.grepExtensions.map(ext => `--include=*.${ext}`),
      "-E",
      pattern,
      searchPath,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  await proc.exited;

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  if (stderr && !stdout) {
    // grep returns exit code 1 for no matches, which is fine
    if (stderr.includes("No such file")) {
      throw new Error(`Path not found: ${searchPath}`);
    }
  }

  if (!stdout.trim()) {
    return `No matches found for pattern: ${pattern}`;
  }

  // Limit output
  const lines = stdout.trim().split("\n");
  if (lines.length > config.maxResults) {
    return (
      lines.slice(0, config.maxResults).join("\n") +
      `\n\n[... ${lines.length - config.maxResults} more matches ...]`
    );
  }

  return stdout.trim();
}
