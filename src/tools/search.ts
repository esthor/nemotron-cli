/**
 * Search tools: glob and grep
 */

import { resolve } from "path";

const MAX_RESULTS = 100;

export async function glob(pattern: string): Promise<string> {
  const globber = new Bun.Glob(pattern);
  const matches: string[] = [];

  for await (const file of globber.scan({ cwd: process.cwd(), dot: false })) {
    matches.push(file);
    if (matches.length >= MAX_RESULTS) break;
  }

  if (matches.length === 0) {
    return `No files found matching pattern: ${pattern}`;
  }

  let result = matches.join("\n");

  if (matches.length >= MAX_RESULTS) {
    result += `\n\n[... limited to ${MAX_RESULTS} results ...]`;
  }

  return result;
}

export async function grep(pattern: string, path?: string): Promise<string> {
  const searchPath = path ? resolve(path) : process.cwd();

  const proc = Bun.spawn(
    [
      "grep",
      "-rn",
      "--include=*.ts",
      "--include=*.js",
      "--include=*.tsx",
      "--include=*.jsx",
      "--include=*.json",
      "--include=*.md",
      "--include=*.css",
      "--include=*.html",
      "--include=*.py",
      "--include=*.go",
      "--include=*.rs",
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
  if (lines.length > MAX_RESULTS) {
    return (
      lines.slice(0, MAX_RESULTS).join("\n") +
      `\n\n[... ${lines.length - MAX_RESULTS} more matches ...]`
    );
  }

  return stdout.trim();
}
