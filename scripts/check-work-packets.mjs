#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const packetDir = "docs/work-packets";
const activeStatuses = new Set(["active", "review", "verify"]);

const PacketSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(["ready", "active", "blocked", "review", "verify", "done", "deferred"]),
  owner: z.string().min(1),
  role: z.enum(["lead", "worker", "explorer", "reviewer", "verifier", "release"]),
  priority: z.enum(["p0", "p1", "p2", "p3"]),
  objective: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1),
  concerns: z.array(z.string().min(1)).default([]),
  dependencies: z.array(z.string().min(1)).default([]),
  non_goals: z.array(z.string().min(1)).min(1),
  acceptance: z.array(z.string().min(1)).min(1),
  verification: z.object({
    required: z.array(z.string().min(1)).default([]),
    completed: z.array(z.string().min(1)).default([]),
    evidence: z.array(z.string().min(1)).default([])
  }),
  handoff: z.object({
    expected: z.array(z.string().min(1)).default([]),
    completed: z.array(z.string().min(1)).default([]),
    next: z.array(z.string().min(1)).default([])
  }),
  risks: z.array(z.string().min(1)).default([]),
  maintenance_audit: z.object({
    assigned_at: z.string().optional(),
    completed_at: z.string().optional(),
    reviewed_by: z.string().optional(),
    checks: z.array(z.string().min(1)).default([]),
    commit: z.string().optional(),
    notes: z.array(z.string().min(1)).default([])
  }).default({})
});

const files = readdirSync(packetDir)
  .filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"))
  .sort();

const packets = [];
const failures = [];

for (const file of files) {
  const path = join(packetDir, file);

  try {
    const parsed = parse(readFileSync(path, "utf8"));
    const packet = PacketSchema.parse(parsed);
    packets.push({ file: relative(process.cwd(), path), ...packet });
  } catch (error) {
    failures.push(`${path}: ${formatError(error)}`);
  }
}

const ids = new Set();

for (const packet of packets) {
  if (ids.has(packet.id)) {
    failures.push(`${packet.file}: duplicate packet id '${packet.id}'`);
  }
  ids.add(packet.id);

  if (activeStatuses.has(packet.status) && packet.verification.required.length === 0) {
    failures.push(`${packet.file}: active/review/verify packet must have verification.required entries`);
  }

  if (activeStatuses.has(packet.status) && packet.handoff.expected.length === 0) {
    failures.push(`${packet.file}: active/review/verify packet must record handoff.expected`);
  }

  if (packet.status === "done") {
    if (packet.verification.completed.length === 0) {
      failures.push(`${packet.file}: done packet must record verification.completed`);
    }

    if (packet.verification.evidence.length === 0) {
      failures.push(`${packet.file}: done packet must record verification.evidence`);
    }

    if (packet.handoff.completed.length === 0) {
      failures.push(`${packet.file}: done packet must record handoff.completed`);
    }

    if (packet.maintenance_audit.checks.length === 0) {
      failures.push(`${packet.file}: done packet must record maintenance_audit.checks`);
    }

    if (!packet.maintenance_audit.completed_at) {
      failures.push(`${packet.file}: done packet must record maintenance_audit.completed_at`);
    }

    if (!packet.maintenance_audit.reviewed_by) {
      failures.push(`${packet.file}: done packet must record maintenance_audit.reviewed_by`);
    }

    if (!packet.maintenance_audit.commit || !/^[a-f0-9]{7,40}$/.test(packet.maintenance_audit.commit)) {
      failures.push(`${packet.file}: done packet must record maintenance_audit.commit as a git SHA`);
    }
  }
}

const activePackets = packets.filter((packet) => activeStatuses.has(packet.status));

for (let i = 0; i < activePackets.length; i += 1) {
  for (let j = i + 1; j < activePackets.length; j += 1) {
    const left = activePackets[i];
    const right = activePackets[j];
    const overlap = findOwnershipOverlap(left, right);

    if (overlap) {
      failures.push(
        `${left.file} and ${right.file}: active ownership overlap '${overlap.left}' <-> '${overlap.right}'`
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Work packet check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Work packet check passed (${packets.length} packet${packets.length === 1 ? "" : "s"}).`);

function findOwnershipOverlap(left, right) {
  const concernOverlap = findConcernOverlap(
    extractConcerns(left.paths, left.concerns),
    extractConcerns(right.paths, right.concerns)
  );

  if (concernOverlap) {
    return { left: concernOverlap.left, right: concernOverlap.right };
  }

  return findPathOverlap(left.paths, right.paths);
}

function extractConcerns(paths, concerns) {
  const pathConcerns = paths
    .map((path) => path.trim())
    .filter((path) => isConcernScope(path));

  return [...concerns, ...pathConcerns].map((concern) => concern.toLowerCase().replace(/\s+/gu, " ").trim());
}

function isConcernScope(value) {
  return /^(concern|module):/iu.test(value.trim());
}

function findConcernOverlap(leftConcerns, rightConcerns) {
  for (const leftConcern of leftConcerns) {
    for (const rightConcern of rightConcerns) {
      if (leftConcern === rightConcern) {
        return { left: leftConcern, right: rightConcern };
      }
    }
  }

  return undefined;
}

function findPathOverlap(leftPaths, rightPaths) {
  for (const leftPath of leftPaths) {
    for (const rightPath of rightPaths) {
      if (isConcernScope(leftPath) || isConcernScope(rightPath)) {
        continue;
      }

      if (pathsOverlap(leftPath, rightPath)) {
        return { left: leftPath, right: rightPath };
      }
    }
  }

  return undefined;
}

function pathsOverlap(leftPath, rightPath) {
  const left = normalizeOwnedPath(leftPath);
  const right = normalizeOwnedPath(rightPath);
  const leftBase = staticOwnershipPrefix(left);
  const rightBase = staticOwnershipPrefix(right);

  if (leftBase === "." || rightBase === ".") {
    return true;
  }

  return (
    leftBase === rightBase ||
    leftBase.startsWith(`${rightBase}/`) ||
    rightBase.startsWith(`${leftBase}/`)
  );
}

function normalizeOwnedPath(value) {
  const normalized = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/u, "")
    .replace(/^\.\//u, "");

  if (/^(concern|module):/iu.test(normalized)) {
    return ".";
  }

  if (isAbsolute(normalized)) {
    const absolutePath = resolve(normalized);
    const relativePath = relative(process.cwd(), absolutePath).replace(/\\/g, "/");

    return relativePath.startsWith("..") ? "." : relativePath || ".";
  }

  return normalized || ".";
}

function staticOwnershipPrefix(value) {
  const segments = value.split("/");
  const staticSegments = [];

  for (const segment of segments) {
    if (hasGlobSyntax(segment)) {
      break;
    }

    staticSegments.push(segment);
  }

  return staticSegments.join("/") || ".";
}

function hasGlobSyntax(value) {
  return /[*?[\]{}!]/u.test(value);
}

function formatError(error) {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`).join("; ");
  }

  return error instanceof Error ? error.message : String(error);
}
