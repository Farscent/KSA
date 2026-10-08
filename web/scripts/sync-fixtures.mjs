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

mkdirSync(destDir, { recursive: true });

const entries = readdirSync(sourceDir, { withFileTypes: true });
let copied = 0;
for (const entry of entries) {
  if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
  copyFileSync(join(sourceDir, entry.name), join(destDir, entry.name));
  copied += 1;
}

console.log(`sync-fixtures: copied ${copied} fixture file(s) to web/fixtures/`);
