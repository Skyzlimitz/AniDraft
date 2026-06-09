/**
 * Minimal structured logger: one JSON object per line.
 *
 * Fly aggregates a machine's stdout/stderr, so emitting JSON lines makes the
 * worker's output queryable in `fly logs` without any extra dependency. Errors
 * go to stderr; everything else to stdout.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  /** Minimum level to emit. Defaults to `LOG_LEVEL` env, else `info`. */
  minLevel?: LogLevel;
  /** Override the output sink (used in tests). Receives a complete JSON line. */
  sink?: (line: string) => void;
  /** Injectable clock for deterministic timestamps in tests. */
  now?: () => Date;
}

function resolveMinLevel(explicit?: LogLevel): LogLevel {
  if (explicit) return explicit;
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}

export function createLogger(name: string, options: LoggerOptions = {}): Logger {
  const minLevel = resolveMinLevel(options.minLevel);
  const now = options.now ?? (() => new Date());
  const { sink } = options;

  function emit(
    level: LogLevel,
    msg: string,
    fields?: Record<string, unknown>,
  ): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
    const line = JSON.stringify({
      level,
      time: now().toISOString(),
      name,
      msg,
      ...fields,
    });
    if (sink) {
      sink(line);
    } else if (level === "error") {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  }

  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  };
}
