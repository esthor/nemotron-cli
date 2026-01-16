/**
 * Bash command execution tool
 */

const TIMEOUT_MS = 30_000; // 30 second timeout
const MAX_OUTPUT = 50_000; // 50KB output limit

export async function bash(command: string): Promise<string> {
  const proc = Bun.spawn(["bash", "-c", command], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, TERM: "dumb" },
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      proc.kill();
      reject(new Error(`Command timed out after ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([proc.exited, timeoutPromise]);

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    let output = "";

    if (stdout) {
      output += stdout;
    }

    if (stderr) {
      output += output ? "\n" : "";
      output += `[stderr]\n${stderr}`;
    }

    if (!output) {
      output = `Command completed with exit code ${result}`;
    }

    // Truncate if too long
    if (output.length > MAX_OUTPUT) {
      output = output.slice(0, MAX_OUTPUT) + "\n\n[... output truncated ...]";
    }

    return output;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Command failed: ${String(error)}`);
  }
}
