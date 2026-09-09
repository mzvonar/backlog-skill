#!/usr/bin/env node
// verify-migration.mjs — run between `migrate.py` and committing its output.
//
//   node verify-migration.mjs <source-ledger.md> <output-dir>
//
// exit 0 = nothing lost, both extractions agree  ·  1 = findings  ·  2 = usage / IO
//
// `migrate.py` reports what it could not derive. This answers the different question — what it did
// not SEE — and every trap in reference/migration-traps.md was found by one of these two checks:
//
//   COVERAGE  does every byte of the source appear somewhere in the output?
//             Traps 6 and 7 were invisible to every count: item bodies read a clean 251/251 while
//             23 section intros and one whole item were on the floor. A check whose unit is the
//             thing the tool already models cannot see what the tool does not model.
//
//   STATUS    does a SECOND extractor, written differently, agree on WHICH items are closed?
//             Traps 4 and 5. The counts were 44 against 40 and the near-match read as agreement
//             until the two were diffed as sets — four apart still looks close enough.
//
// On independence, honestly: this is a DIFFERENTIAL check, not an independent one. The real cross-
// check that found traps 4 and 5 was written by someone who had not read `migrate.py`, and no
// shipped file can preserve that. Two things still make it worth running — it is written in the
// other language, so the two cannot share code by accident, and it derives the status zone from
// the item's structure rather than by pattern, so they fail differently. What it will not do is
// notice a shape BOTH implementations get wrong. When this passes and something still looks off,
// hand-write a third extractor; that is what the traps document means by refusing a near-match.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const [source, outDir] = process.argv.slice(2);
if (!source || !outDir) {
  process.stderr.write("usage: verify-migration.mjs <source-ledger.md> <output-dir>\n");
  process.exit(2);
}

let srcText;
try {
  srcText = readFileSync(source, "utf-8");
} catch (e) {
  process.stderr.write(`cannot read ${source}: ${e.message}\n`);
  process.exit(2);
}

const detailDir = path.join(outDir, "deferred-work");
const indexPath = path.join(outDir, "deferred-work.md");
let indexText, detailFiles;
try {
  indexText = readFileSync(indexPath, "utf-8");
  detailFiles = readdirSync(detailDir).filter((n) => n.endsWith(".md")).sort();
} catch (e) {
  process.stderr.write(`cannot read the migration output under ${outDir}: ${e.message}\n`);
  process.exit(2);
}

const details = detailFiles.map((name) => {
  const text = readFileSync(path.join(detailDir, name), "utf-8");
  const end = text.indexOf("\n---", 4);
  return {
    name,
    front: text.slice(0, end + 4),
    body: text.slice(end + 4).trim(),
    status: (/^status:[ \t]*(?<s>.*)$/mu.exec(text)?.groups.s ?? "").trim(),
  };
});

// ---------------------------------------------------------------- segmentation
// Section = a `## ` heading and everything to the next one. Item = a top-level `- ` bullet and
// everything to the next one, which is why an item's block can hold a trailing sub-heading.
const lines = srcText.split("\n");
const secStarts = lines.map((l, i) => (l.startsWith("## ") ? i : -1)).filter((i) => i >= 0);
const items = [];
const sections = [];
for (const [k, a] of secStarts.entries()) {
  const b = secStarts[k + 1] ?? lines.length;
  const body = lines.slice(a + 1, b);
  const bullets = body.map((l, i) => (/^- /u.test(l) ? i : -1)).filter((i) => i >= 0);
  sections.push({ head: lines[a], line: a + 1, hasItems: bullets.length > 0 });
  for (const [j, s] of bullets.entries()) {
    const e = bullets[j + 1] ?? body.length;
    const block = body.slice(s, e).join("\n").replace(/\s+$/u, "");
    if (block.trim()) items.push({ block, line: a + 2 + s, sec: sections.length - 1 });
  }
}

const PREAMBLE = "\u0000preamble";
const findings = [];
const notices = [];
const add = (code, where, detail) => findings.push({ code, where, detail });

// ---------------------------------------------------------------- A. item parity
if (items.length > details.length) {
  add("ITEM_COUNT", path.basename(source),
    `${items.length} item blocks in the source, ${details.length} detail files — ${items.length - details.length} unaccounted for`);
}

// ---------------------------------------------------------------- B. verbatim bodies
const allBodies = details.map((d) => d.body).join("\n\n");
for (const it of items) {
  if (!allBodies.includes(it.block.trim())) {
    add("BODY_NOT_VERBATIM", `${path.basename(source)}:${it.line}`,
      `no detail file contains this item's block verbatim — ${it.block.split("\n")[0].slice(0, 70)}`);
  }
}

// ---------------------------------------------------------------- C. line coverage
// Everything else: section headings, intro prose, a section with no bullets at all. Line-level
// because that content has no unit of its own — it is not an item, so nothing counts it.
const haystack = `${allBodies}\n${indexText}`;
const uncovered = new Map();
for (const [i, raw] of lines.entries()) {
  const line = raw.trim();
  if (!line) continue;
  if (haystack.includes(line)) continue;
  const sec = sections.filter((s) => s.line <= i + 1).pop();
  // Content above the first `## ` is the file's PREAMBLE, and the migration replaces it with the
  // index's own header on purpose: a preamble typically documents the old layout ("one bullet =
  // one item", "mark it **DONE**"), which is exactly what stops being true. Reported, not failed —
  // but printed in full, because it is also where a policy note or an owner would have been.
  const key = sec ? sec.head.slice(0, 70) : PREAMBLE;
  if (!uncovered.has(key)) uncovered.set(key, []);
  uncovered.get(key).push({ n: i + 1, line });
}
for (const [sec, ls] of uncovered) {
  if (sec === PREAMBLE) {
    notices.push(`the preamble above the first section was replaced by the index header — ${ls.length} line(s), read them before committing:`);
    for (const l of ls) notices.push(`    ${String(l.n).padStart(5)}  ${l.line.slice(0, 96)}`);
    continue;
  }
  add("CONTENT_DROPPED", `${path.basename(source)}:${ls[0].n}`,
    `${ls.length} line(s) appear nowhere in the output, under ${sec} — first: ${ls[0].line.slice(0, 70)}`);
}

// ---------------------------------------------------------------- D. the second extractor
// Deliberately NOT migrate.py's method: code spans are stripped structurally, so prose that quotes
// the convention cannot match, rather than being excluded by spotting a `YYYY-MM-DD` placeholder.
const CLOSED = /\*\*\s*(?:[^\w\s]\s*)?(?:DONE|KILLED)\b/u;
const HALF = /HALF\s+DONE/iu;
const STRUCK = /^-\s+~~/u;

const ownText = (block) => {
  const out = [];
  for (const [k, ln] of block.split("\n").entries()) {
    if (k && /^\s+[-*] /u.test(ln)) break;          // a child bullet is context, not status
    if (k && ln.trim() && !/^\s/u.test(ln)) break;  // the left margin has left the item
    out.push(ln);
  }
  return out.join(" ").split(/\s+/u).join(" ");
};

const theirs = new Set();
details.forEach((d, i) => { if (d.status && d.status !== "open") theirs.add(i + 1); });

const mine = new Set();
items.forEach((it, i) => {
  const flat = ownText(it.block);
  if (STRUCK.test(flat)) { mine.add(i + 1); return; }
  const bare = flat.replace(/`[^`]*`/gu, " ");
  const m = CLOSED.exec(bare);
  if (m && !HALF.test(bare.slice(Math.max(0, m.index - 10), m.index + m[0].length))) mine.add(i + 1);
});

// Diffed as SETS. Comparing sizes is what let a 4-item disagreement read as agreement.
if (items.length === details.length) {
  for (const n of [...mine].filter((n) => !theirs.has(n)).sort((a, b) => a - b)) {
    add("STATUS_DISAGREE", `${path.basename(source)}:${items[n - 1].line}`,
      `this extractor reads CLOSED, the migration wrote '${details[n - 1].status}' — ${ownText(items[n - 1].block).slice(0, 80)}`);
  }
  for (const n of [...theirs].filter((n) => !mine.has(n)).sort((a, b) => a - b)) {
    add("STATUS_DISAGREE", `${path.basename(source)}:${items[n - 1].line}`,
      `the migration wrote '${details[n - 1].status}', this extractor reads OPEN — ${ownText(items[n - 1].block).slice(0, 80)}`);
  }
} else {
  add("STATUS_UNCHECKED", path.basename(source),
    "item counts differ, so items cannot be lined up with detail files — fix that first");
}

// ---------------------------------------------------------------- report
for (const n of notices) process.stdout.write(`${n.startsWith("    ") ? "" : "NOTICE             "}${n}\n`);
for (const f of findings) process.stdout.write(`${f.code.padEnd(18)} ${f.where}: ${f.detail}\n`);
process.stdout.write(
  findings.length === 0
    ? `verify-migration: ${items.length} items, ${sections.length} sections — nothing dropped, both extractions agree on ${mine.size} closed\n`
    : `verify-migration: ${findings.length} finding(s) — do NOT commit this migration yet\n`,
);
process.exit(findings.length === 0 ? 0 : 1);
