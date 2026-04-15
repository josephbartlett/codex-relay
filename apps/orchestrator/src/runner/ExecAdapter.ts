import { spawn, type ChildProcess } from "node:child_process";
import { buildCodexExecArgs, buildCodexExecResumeArgs } from "../../../local-runner/src/codex/exec.js";
import { createJsonlParser, type JsonObject } from "../../../local-runner/src/codex/jsonlParser.js";
import type {
  RunHandle,
  RunnerAdapter,
  RunnerEventSink,
  RunnerResult,
  RunnerTaskSpec
} from "../../../../packages/shared/src/types.js";

export interface ExecAdapterOptions {
  command: string;
  model?: string;
  envAllowlist: string[];
}

export class ExecAdapter implements RunnerAdapter {
  private readonly active = new Map<string, ChildProcess>();

  constructor(private readonly options: ExecAdapterOptions) {}

  start(task: RunnerTaskSpec, sink?: RunnerEventSink): RunHandle {
    return this.spawnCodex({ ...task, model: task.model ?? this.options.model }, sink);
  }

  resume(sessionId: string, prompt: string, sink?: RunnerEventSink): RunHandle {
    void prompt;
    void sink;
    throw new Error(
      `ExecAdapter.resume(${sessionId}) requires an explicit workspace. Use start({ codexSessionId, workspacePath, ... }) instead.`
    );
  }

  async cancel(runId: string): Promise<void> {
    const child = this.active.get(runId);

    if (!child) {
      return;
    }

    child.kill("SIGTERM");
    this.active.delete(runId);
  }

  private spawnCodex(task: RunnerTaskSpec, sink?: RunnerEventSink): RunHandle {
    const runId = task.runId;
    const args = task.codexSessionId
      ? buildCodexExecResumeArgs(task, task.codexSessionId)
      : buildCodexExecArgs(task);

    const child = spawn(this.options.command, args, {
      cwd: task.workspacePath,
      env: buildRunnerEnvironment(process.env, this.options.envAllowlist),
      stdio: ["ignore", "pipe", "pipe"]
    });

    this.active.set(runId, child);

    let stdout = "";
    let stderr = "";
    let finalMessage = "";
    let codexSessionId = task.codexSessionId;

    const emit = (type: string, message?: string, raw?: unknown) => {
      void sink?.({
        runId,
        type,
        message,
        raw,
        at: new Date().toISOString()
      });
    };

    const parser = createJsonlParser((event) => {
      const extractedSessionId = extractSessionId(event);
      const text = extractText(event);

      if (extractedSessionId) {
        codexSessionId = extractedSessionId;
      }

      if (text) {
        finalMessage = text;
      }

      emit(String(event.type ?? "codex_event"), text, event);
    });

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      parser.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      emit("stderr", text);
    });

    const promise = new Promise<RunnerResult>((resolve) => {
      child.on("error", (error) => {
        this.active.delete(runId);
        resolve({
          runId,
          status: "failed",
          finalMessage: error.message,
          stdout,
          stderr,
          codexSessionId,
          exitCode: null
        });
      });

      child.on("close", (exitCode, signal) => {
        parser.flush();
        this.active.delete(runId);

        const status = signal === "SIGTERM" ? "cancelled" : exitCode === 0 ? "completed" : "failed";

        resolve({
          runId,
          status,
          finalMessage: finalMessage || fallbackFinalMessage(stdout, stderr, status),
          stdout,
          stderr,
          codexSessionId,
          exitCode
        });
      });
    });

    return {
      runId,
      promise,
      cancel: () => this.cancel(runId)
    };
  }
}

export function buildRunnerEnvironment(source: NodeJS.ProcessEnv, allowlist: string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const name of new Set(allowlist.map((entry) => entry.trim()).filter(Boolean))) {
    const value = source[name];

    if (typeof value === "string") {
      env[name] = value;
    }
  }

  env.NO_COLOR = "1";
  return env;
}

function extractSessionId(event: JsonObject): string | undefined {
  for (const key of ["session_id", "sessionId", "thread_id", "threadId", "conversation_id"]) {
    const value = event[key];

    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  const nested = event["msg"] ?? event["item"];

  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return extractSessionId(nested as JsonObject);
  }

  return undefined;
}

function extractText(event: JsonObject): string | undefined {
  for (const key of ["message", "text", "content", "final_message"]) {
    const value = event[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  const item = event["item"];

  if (item && typeof item === "object" && !Array.isArray(item)) {
    const itemText = extractText(item as JsonObject);

    if (itemText) {
      return itemText;
    }
  }

  const content = event["content"];

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
          return part.text;
        }

        return "";
      })
      .join("")
      .trim();

    return text || undefined;
  }

  return undefined;
}

function fallbackFinalMessage(stdout: string, stderr: string, status: RunnerResult["status"]): string {
  const source = stdout.trim() || stderr.trim();

  if (!source) {
    if (status === "cancelled") {
      return "Codex run was cancelled.";
    }

    return status === "completed" ? "Codex completed without a final message." : "Codex did not produce output.";
  }

  return source.split(/\r?\n/).slice(-20).join("\n");
}
