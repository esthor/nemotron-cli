/**
 * Bash command execution tool
 */

export interface BashConfig {
  timeoutMs: number;
  maxOutputBytes: number;
}

const DEFAULTS: BashConfig = { timeoutMs: 30_000, maxOutputBytes: 50_000 };

export async function bash(command: string, config: BashConfig = DEFAULTS): Promise<string> {
  const proc = Bun.spawn(["bash", "-c", command], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, TERM: "dumb" },
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      proc.kill();
      reject(new Error(`Command timed out after ${config.timeoutMs / 1000}s`));
    }, config.timeoutMs);
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
    if (output.length > config.maxOutputBytes) {
      output = output.slice(0, config.maxOutputBytes) + "\n\n[... output truncated ...]";
    }

    return output;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Command failed: ${String(error)}`);
  }
}
