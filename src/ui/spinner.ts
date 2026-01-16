/**
 * Terminal spinner for loading states
 */

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_INTERVAL = 80;

export class Spinner {
  private frameIndex = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private message: string;

  constructor(message: string = "Thinking...") {
    this.message = message;
  }

  start(): void {
    if (this.interval) return;

    process.stdout.write("\x1B[?25l"); // Hide cursor

    this.interval = setInterval(() => {
      const frame = SPINNER_FRAMES[this.frameIndex];
      process.stdout.write(`\r\x1B[36m${frame}\x1B[0m ${this.message}`);
      this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
    }, FRAME_INTERVAL);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      process.stdout.write("\r\x1B[K"); // Clear line (only if spinner was running)
      process.stdout.write("\x1B[?25h"); // Show cursor
    }
  }

  update(message: string): void {
    this.message = message;
  }
}

// ANSI color helpers
export const colors = {
  reset: "\x1B[0m",
  bold: "\x1B[1m",
  dim: "\x1B[2m",
  cyan: "\x1B[36m",
  green: "\x1B[32m",
  yellow: "\x1B[33m",
  red: "\x1B[31m",
  magenta: "\x1B[35m",
  gray: "\x1B[90m",
};

export function colorize(text: string, color: keyof typeof colors): string {
  return `${colors[color]}${text}${colors.reset}`;
}
