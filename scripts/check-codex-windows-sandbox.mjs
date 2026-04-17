#!/usr/bin/env node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";

if (!isWindows) {
  console.log(JSON.stringify({ ok: true, skipped: true, reason: "not_windows" }));
  process.exit(0);
}

const codexCommand = process.env.CODEX_COMMAND || "codex";
const tempRoot = await mkdtemp(join(tmpdir(), "codex-relay-sandbox-"));
const outputFile = join(tempRoot, "workspace-write-smoke.txt");
const outputFileName = "workspace-write-smoke.txt";
const content = "Codex Relay Windows sandbox write smoke passed.";

try {
  const result = await runCodexSandbox({
    codexCommand,
    cwd: tempRoot,
    outputFileName,
    content
  });

  if (result.exitCode !== 0) {
    console.log(JSON.stringify({
      ok: false,
      skipped: false,
      errorClass: "codex_windows_sandbox_write_failed",
      exitCode: result.exitCode,
      stderr: sanitize(result.stderr)
    }));
    process.exit(1);
  }

  const written = await readFile(outputFile, "utf8").catch(() => "");
  if (written !== content) {
    console.log(JSON.stringify({
      ok: false,
      skipped: false,
      errorClass: "codex_windows_sandbox_output_missing"
    }));
    process.exit(1);
  }

  console.log(JSON.stringify({ ok: true, skipped: false }));
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

function runCodexSandbox({ codexCommand, cwd, outputFileName, content }) {
  const commandLine = [
    quote(codexCommand),
    "sandbox",
    "windows",
    "--full-auto",
    "powershell.exe",
    "-NoProfile",
    "-Command",
    quote(`Set-Content -LiteralPath '.\\${outputFileName}' -Value '${content}' -NoNewline`)
  ].join(" ");

  return new Promise((resolve) => {
    const child = spawn(commandLine, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ exitCode: null, stdout, stderr: `${stderr}\n${error.message}` });
    });
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function sanitize(value) {
  return String(value)
    .replace(/[A-Za-z]:\\[^\r\n"]+/g, "<path>")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "<email>")
    .trim()
    .slice(0, 500);
}
