/**
 * File operation tools: read, write, edit
 */

import { resolve } from "path";

const MAX_FILE_SIZE = 100 * 1024; // 100KB limit

export async function readFile(path: string): Promise<string> {
  const resolved = resolve(path);
  const file = Bun.file(resolved);

  if (!(await file.exists())) {
    throw new Error(`File not found: ${path}`);
  }

  const size = file.size;
  if (size > MAX_FILE_SIZE) {
    const content = await file.text();
    const truncated = content.slice(0, MAX_FILE_SIZE);
    return `${truncated}\n\n[... truncated, file is ${Math.round(size / 1024)}KB ...]`;
  }

  return await file.text();
}

export async function writeFile(path: string, content: string): Promise<string> {
  const resolved = resolve(path);
  await Bun.write(resolved, content);
  return `Successfully wrote ${content.length} bytes to ${path}`;
}

export async function editFile(
  path: string,
  search: string,
  replace: string
): Promise<string> {
  const resolved = resolve(path);
  const file = Bun.file(resolved);

  if (!(await file.exists())) {
    throw new Error(`File not found: ${path}`);
  }

  const content = await file.text();

  if (!content.includes(search)) {
    throw new Error(`Search string not found in ${path}`);
  }

  const newContent = content.replace(search, replace);
  await Bun.write(resolved, newContent);

  const occurrences = (content.match(new RegExp(escapeRegex(search), "g")) || [])
    .length;

  return `Successfully replaced ${occurrences} occurrence(s) in ${path}`;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
