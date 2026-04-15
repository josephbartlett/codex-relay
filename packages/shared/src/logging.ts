export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export function createLogger(scope: string): Logger {
  return {
    info: (message, meta) => write("info", scope, message, meta),
    warn: (message, meta) => write("warn", scope, message, meta),
    error: (message, meta) => write("error", scope, message, meta)
  };
}

function write(
  level: "info" | "warn" | "error",
  scope: string,
  message: string,
  meta?: Record<string, unknown>
): void {
  const line = {
    level,
    scope,
    message,
    time: new Date().toISOString(),
    ...meta
  };

  const serialized = JSON.stringify(line);

  if (level === "error") {
    console.error(serialized);
    return;
  }

  if (level === "warn") {
    console.warn(serialized);
    return;
  }

  console.log(serialized);
}
