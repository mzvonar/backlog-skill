#!/usr/bin/env node
// The deferred-work backlog, as the classifier sees it: one line per item, frontmatter only.
// Bodies are never read — grooming needs the trigger and the status, not the prose.
//
//   node dw.mjs <dir> [--all] [--json]     default: open items only
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// The closed vocabulary is CORPUS DATA, not a constant. The first real ledger documented two
// words in its own header and used six; assuming the header cost 7 items, which migrated `open`
// into the untriaged set. Widening `migrate.py` alone is half a fix — every consumer that decides
// "is this open?" shares this list, or the newly-closed items still read as open here.
const CLOSED = /^(DONE|KILLED|CLOSED|SUPERSEDED|RETIRED|RESOLVED)\b/u;

const [dir, ...flags] = process.argv.slice(2);
const all = flags.includes("--all");

// Frontmatter only: stop at the closing fence, so a 20KB body costs nothing.
const frontmatter = (file) => {
  const out = {};
  const lines = readFileSync(file, "utf-8").split("\n");
  if (lines[0]?.trim() !== "---") return null;
  for (const line of lines.slice(1)) {
    if (line.trim() === "---") break;
    const m = /^(?<k>[a-z_]+):\s*(?<v>.*)$/u.exec(line);
    if (m) out[m.groups.k] = m.groups.v.replace(/^['"]|['"]$/gu, "");
  }
  return out;
};

const items = readdirSync(dir)
  .filter((n) => n.endsWith(".md"))
  .map((n) => ({ file: n, ...(frontmatter(path.join(dir, n)) ?? {}) }))
  .filter((i) => i.id)
  .filter((i) => all || !CLOSED.test(i.status ?? ""));

if (flags.includes("--json")) {
  console.log(JSON.stringify(items, null, 2));
} else {
  for (const i of items) {
    console.log(`${i.id}  [${(i.status ?? "?").padEnd(17)}] ${i.summary}`);
    console.log(`${" ".repeat(9)}trigger: ${i.trigger}   ← ${i.file}`);
  }
  console.log(`\n${items.length} ${all ? "total" : "open"} item(s)`);
}
