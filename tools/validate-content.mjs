#!/usr/bin/env node
/**
 * Frontmatter + manifest validator for ANTIKYTHERA.
 *
 * The site has no build step: content/*.md is fetched and parsed in the
 * browser at runtime. A malformed entry therefore deploys successfully and
 * fails silently for the visitor. This script is the missing compile step.
 *
 * It deliberately reuses the SAME lossy parser as app.js, so it validates
 * what the runtime actually sees rather than what a stricter YAML library
 * would see. Lines that the runtime parser silently discards are reported
 * as errors, because those are the failures nobody notices.
 *
 * Usage:  node tools/validate-content.mjs
 * Exit:   0 = clean, 1 = at least one error
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = join(ROOT, 'content');

/* ------------------------------------------------------------------ *
 * parser — mirrors parseFrontmatter() in app.js exactly
 * ------------------------------------------------------------------ */

function unquote(s) {
  s = s.trim();
  if ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'")) {
    return s.slice(1, -1);
  }
  return s;
}

function parseFrontmatter(raw) {
  const text = raw.replace(/^\uFEFF/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;

  const data = {};
  const dropped = [];

  m[1].split(/\r?\n/).forEach((line, i) => {
    if (!line.trim() || /^\s*#/.test(line)) return;
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) {
      // The runtime throws this line away without a word. That is the bug class.
      dropped.push({ line: i + 2, text: line.trim().slice(0, 70) });
      return;
    }
    const key = kv[1];
    const val = kv[2].trim();
    if (val === '') data[key] = '';
    else if (val[0] === '[' && val.at(-1) === ']') {
      const inner = val.slice(1, -1).trim();
      data[key] = inner ? inner.split(',').map(unquote) : [];
    } else if (/^-?\d+$/.test(val)) data[key] = parseInt(val, 10);
    else data[key] = unquote(val);
  });

  return { data, body: m[2], dropped, keyOrder: Object.keys(data) };
}

/* ------------------------------------------------------------------ *
 * schema
 * ------------------------------------------------------------------ */

const SPHERES = ['mechane', 'ephemeris', 'mnemosyne'];
const KINDS = ['instrument', 'field-note', 'reliquary'];
const PREFIX = { mechane: 'MEC', ephemeris: 'EPH', mnemosyne: 'MNE' };

const REQUIRED = [
  'title',
  'designation',
  'slug',
  'sphere',
  'kind',
  'date',
  'status',
  'sigil',
  'reading',
  'summary',
  'tags',
];

const KNOWN = new Set([
  ...REQUIRED,
  'revised',
  'epigraph',
  'stack',
  'resonance',
  'external',
  'external_label',
  'license',
  'plate',
  'plate_caption',
  'status_note',
]);

/* ------------------------------------------------------------------ *
 * reporting
 * ------------------------------------------------------------------ */

const report = new Map();
let errorCount = 0;
let warnCount = 0;

function log(file, level, msg) {
  if (!report.has(file)) report.set(file, []);
  report.get(file).push({ level, msg });
  if (level === 'error') errorCount++;
  else warnCount++;
}
const err = (f, m) => log(f, 'error', m);
const warn = (f, m) => log(f, 'warn', m);

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function badDate(v) {
  if (typeof v !== 'string' || !ISO.test(v)) return 'not an ISO date (YYYY-MM-DD)';
  const d = new Date(v + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return 'not a real calendar date';
  if (d.getTime() > Date.now()) return `dated in the future (${v})`;
  return null;
}

const isArr = (v) => Array.isArray(v);

/* ------------------------------------------------------------------ *
 * load manifest
 * ------------------------------------------------------------------ */

const MANIFEST = 'content/manifest.json';
let manifest = null;

try {
  manifest = JSON.parse(readFileSync(join(CONTENT, 'manifest.json'), 'utf8'));
} catch (e) {
  err(MANIFEST, `does not parse as JSON — ${e.message}`);
}

/* ------------------------------------------------------------------ *
 * walk entries
 * ------------------------------------------------------------------ */

const files = readdirSync(CONTENT)
  .filter((f) => f.endsWith('.md'))
  .sort();

const entries = new Map(); // slug -> { file, data }
const seenDesignation = new Map();
const seenSigil = new Map();

for (const file of files) {
  const rel = `content/${file}`;
  const raw = readFileSync(join(CONTENT, file), 'utf8');
  const parsed = parseFrontmatter(raw);

  if (!parsed) {
    err(rel, 'no frontmatter block — file must open with `---` and close with `---`');
    continue;
  }

  const { data, body, dropped } = parsed;

  for (const d of dropped) {
    err(
      rel,
      `line ${d.line} is silently discarded by the runtime parser: "${d.text}" ` +
        '(only single-line `key: value` pairs are supported)'
    );
  }

  // required
  for (const k of REQUIRED) {
    if (!(k in data) || data[k] === '' || (isArr(data[k]) && data[k].length === 0)) {
      err(rel, `missing required field \`${k}\``);
    }
  }

  // unknown keys — typos land here
  for (const k of Object.keys(data)) {
    if (!KNOWN.has(k)) warn(rel, `unrecognized field \`${k}\` — typo, or update the schema`);
  }

  // slug
  const expected = basename(file, '.md');
  if (data.slug && data.slug !== expected) {
    err(rel, `slug \`${data.slug}\` does not match filename (expected \`${expected}\`)`);
  }

  // sphere / kind
  if (data.sphere && !SPHERES.includes(data.sphere)) {
    err(rel, `sphere \`${data.sphere}\` is not one of ${SPHERES.join(', ')}`);
  }
  if (data.kind && !KINDS.includes(data.kind)) {
    err(rel, `kind \`${data.kind}\` is not one of ${KINDS.join(', ')}`);
  }

  // designation
  if (data.designation) {
    const dm = /^(MEC|EPH|MNE)-(\d{3})$/.exec(data.designation);
    if (!dm) {
      err(rel, `designation \`${data.designation}\` must match PREFIX-000 (e.g. MEC-001)`);
    } else {
      if (data.sphere && PREFIX[data.sphere] && dm[1] !== PREFIX[data.sphere]) {
        err(
          rel,
          `designation prefix \`${dm[1]}\` contradicts sphere \`${data.sphere}\` ` +
            `(expected \`${PREFIX[data.sphere]}\`)`
        );
      }
      const prior = seenDesignation.get(data.designation);
      if (prior) err(rel, `designation \`${data.designation}\` already used by ${prior}`);
      else seenDesignation.set(data.designation, rel);
    }
  }

  // sigil — collisions produce two identical glyphs, which reads as a bug
  if ('sigil' in data) {
    if (!Number.isInteger(data.sigil)) {
      err(rel, 'sigil must be a plain integer seed');
    } else {
      const prior = seenSigil.get(data.sigil);
      if (prior) err(rel, `sigil seed ${data.sigil} already used by ${prior} — glyphs would be identical`);
      else seenSigil.set(data.sigil, rel);
    }
  }

  // reading
  if ('reading' in data && (!Number.isInteger(data.reading) || data.reading < 1)) {
    err(rel, 'reading must be a positive integer (minutes)');
  }

  // dates
  if (data.date) {
    const bad = badDate(data.date);
    if (bad) err(rel, `date ${bad}`);
  }
  if (data.revised) {
    const bad = badDate(data.revised);
    if (bad) err(rel, `revised ${bad}`);
    else if (data.date && !badDate(data.date) && data.revised < data.date) {
      err(rel, `revised (${data.revised}) precedes date (${data.date})`);
    }
  }

  // list fields
  for (const k of ['tags', 'stack', 'resonance']) {
    if (k in data && !isArr(data[k])) {
      err(rel, `\`${k}\` must be an inline list, e.g. [one, two]`);
    }
  }

  if (isArr(data.tags)) {
    for (const t of data.tags) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(t)) {
        err(rel, `tag \`${t}\` must be lowercase alphanumeric with hyphens`);
      }
    }
    const dupes = data.tags.filter((t, i) => data.tags.indexOf(t) !== i);
    if (dupes.length) warn(rel, `duplicate tags: ${[...new Set(dupes)].join(', ')}`);
  }

  // external
  if (data.external && !/^https?:\/\/\S+$/.test(data.external)) {
    err(rel, `external \`${data.external}\` is not an http(s) URL`);
  }
  if (data.external && !data.external_label) {
    warn(rel, 'external link has no external_label — the button will read generically');
  }
  if (data.external_label && !data.external) {
    warn(rel, 'external_label set with no external URL — it will not render');
  }

  // plate
  if (data.plate) {
    if (!existsSync(join(ROOT, data.plate))) {
      err(rel, `plate image \`${data.plate}\` does not exist`);
    }
    if (!data.plate_caption) warn(rel, 'plate has no plate_caption');
  }
  if (data.plate_caption && !data.plate) {
    warn(rel, 'plate_caption set with no plate — it will not render');
  }

  // body
  if (!body || body.trim().length < 40) {
    err(rel, 'body is empty or too short to render');
  }

  if (data.slug) entries.set(data.slug, { file: rel, data });
}

/* ------------------------------------------------------------------ *
 * cross-file: resonance links
 * ------------------------------------------------------------------ */

for (const [slug, { file, data }] of entries) {
  if (!isArr(data.resonance)) continue;
  const seen = new Set();
  for (const target of data.resonance) {
    if (target === slug) err(file, 'resonance links to itself');
    else if (!entries.has(target)) err(file, `resonance target \`${target}\` does not exist`);
    if (seen.has(target)) warn(file, `duplicate resonance target \`${target}\``);
    seen.add(target);
  }
}

/* ------------------------------------------------------------------ *
 * cross-file: manifest
 * ------------------------------------------------------------------ */

if (manifest) {
  if (!isArr(manifest.entries)) {
    err(MANIFEST, '`entries` must be an array of filenames');
  } else {
    const listed = new Set();
    for (const name of manifest.entries) {
      if (listed.has(name)) err(MANIFEST, `\`${name}\` listed more than once`);
      listed.add(name);
      if (!files.includes(name)) {
        err(MANIFEST, `\`${name}\` is listed but no such file exists — the dial will render a gap`);
      }
    }
    for (const f of files) {
      if (!listed.has(f)) {
        err(MANIFEST, `content/${f} exists but is not listed in \`entries\` — it will be invisible`);
      }
    }
  }

  const declared = new Set((manifest.spheres || []).map((s) => s.id));
  for (const id of SPHERES) {
    if (!declared.has(id)) err(MANIFEST, `sphere \`${id}\` is used by entries but not declared`);
  }
  for (const s of manifest.spheres || []) {
    if (!Number.isFinite(s.radius)) err(MANIFEST, `sphere \`${s.id}\` has no numeric radius`);
  }
}

/* ------------------------------------------------------------------ *
 * output
 * ------------------------------------------------------------------ */

const RED = '\u001b[31m';
const YEL = '\u001b[33m';
const DIM = '\u001b[2m';
const OFF = '\u001b[0m';

if (report.size) {
  for (const [file, issues] of [...report].sort()) {
    console.log(`\n${file}`);
    for (const { level, msg } of issues) {
      const tag = level === 'error' ? `${RED}error${OFF}` : `${YEL}warn ${OFF}`;
      console.log(`  ${tag}  ${msg}`);
    }
  }
  console.log('');
}

const summary = `${files.length} entries checked · ${errorCount} error(s) · ${warnCount} warning(s)`;

if (errorCount) {
  console.log(`${RED}FAILED${OFF}  ${summary}`);
  process.exit(1);
}

console.log(`${DIM}OK${OFF}      ${summary}`);
