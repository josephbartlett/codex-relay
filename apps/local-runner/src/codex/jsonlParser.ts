export type JsonObject = Record<string, unknown>;

export interface JsonlParser {
  push(chunk: Buffer | string): void;
  flush(): void;
}

export function createJsonlParser(onEvent: (event: JsonObject) => void): JsonlParser {
  let buffer = "";

  return {
    push(chunk) {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        parseLine(line, onEvent);
      }
    },
    flush() {
      if (buffer.trim()) {
        parseLine(buffer, onEvent);
      }

      buffer = "";
    }
  };
}

function parseLine(line: string, onEvent: (event: JsonObject) => void): void {
  const trimmed = line.trim();

  if (!trimmed) {
    return;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      onEvent(parsed as JsonObject);
    }
  } catch {
    onEvent({ type: "unparsed_stdout", message: trimmed });
  }
}
