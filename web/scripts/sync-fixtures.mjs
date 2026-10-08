#!/usr/bin/env node
// Copies the Python repo's committed contract fixtures into web/fixtures/ so
// they sit inside this package's TypeScript project (tests/fixtures/ lives
// outside web/'s tsconfig include). tests/fixtures/ in the repo root stays the
// single source of truth — never hand-edit web/fixtures/ directly.
import { copyFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
const repoRoot = join(webRoot, "..");
const sourceDir = join(repoRoot, "tests", "fixtures");
const destDir = join(webRoot, "fixtures");

if (!existsSync(sourceDir)) {
  console.error(`sync-fixtures: source directory not found: ${sourceDir}`);
  process.exit(1);
}

// Top-level contract fixtures, plus the captured provider responses under
// research/. The synthetic-* snapshot directories are Python-only and stay put.
const SYNCED_SUBDIRS = ["research"];

function syncJson(fromDir, toDir) {
  mkdirSync(toDir, { recursive: true });
  let count = 0;
  for (const entry of readdirSync(fromDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    copyFileSync(join(fromDir, entry.name), join(toDir, entry.name));
    count += 1;
  }
  return count;
}

let copied = syncJson(sourceDir, destDir);
for (const sub of SYNCED_SUBDIRS) {
  const from = join(sourceDir, sub);
  if (!existsSync(from)) {
    console.error(`sync-fixtures: source directory not found: ${from}`);
    process.exit(1);
  }
  copied += syncJson(from, join(destDir, sub));
}

console.log(`sync-fixtures: copied ${copied} fixture file(s) to web/fixtures/`);
