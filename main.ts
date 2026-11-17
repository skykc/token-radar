// Token Radar's entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot, scores every pre-token protocol with the
// calibrated model in lib/model.ts, writes the ranked board to
// /output/board.json, writes the dashboard's data as /output/data.js, copies
// this repository's dashboard/ and screenshots/ to /output, and writes
// /output/dossier.json with the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network:
// dashboard/index.html, dashboard/app.css and dashboard/app.js read the
// data.js this program writes beside them.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output
// and MAKEFUN_INPUT_DIR (or --input) stands in for /input:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
// The program is deterministic: two runs on the same snapshot write the
// same bytes, with no timestamp and no randomness anywhere in its output.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

/** The first snapshot path that exists, from the argument, the environment, then the known mounts. */
function findInput(): string {
  const fromArg = process.argv.includes('--input') ? arg('input', '') : '';
  const candidates: string[] = [];
  if (fromArg !== '') candidates.push(fromArg.endsWith('.json') ? fromArg : join(fromArg, 'snapshot.json'));
  const envDir = process.env.MAKEFUN_INPUT_DIR;
  if (envDir !== undefined && envDir !== '') candidates.push(join(envDir, 'snapshot.json'));
  candidates.push('/input/snapshot.json', join(here, '..', 'input', 'snapshot.json'), join(here, 'input', 'snapshot.json'));
  for (const c of candidates) if (existsSync(c)) return c;
  return candidates[0]!;
}

const inputFile = findInput();
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dash = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

// Read back what was written: the board's first row must be the dashboard
// data's first row, so the page and the board can never drift apart.
const writtenBoard = JSON.parse(readFileSync(join(out, 'board.json'), 'utf8')) as { rows: { slug: string }[] };
const writtenData = readFileSync(join(out, 'data.js'), 'utf8');
const dataJson = JSON.parse(writtenData.replace(/^window\.RADAR=/, '').replace(/;\s*$/, '')) as { rows: { slug: string }[] };
if (writtenBoard.rows.length !== board.length || dataJson.rows.length !== board.length) {
  process.stderr.write(`token radar: wrote ${writtenBoard.rows.length} board rows but ${dataJson.rows.length} dashboard rows: refusing a split output\n`);
  process.exit(1);
}
if (writtenBoard.rows[0]!.slug !== dataJson.rows[0]!.slug) {
  process.stderr.write(`token radar: board rank 1 is ${writtenBoard.rows[0]!.slug} but the dashboard opens with ${dataJson.rows[0]!.slug}\n`);
  process.exit(1);
}
JSON.parse(readFileSync(join(out, 'dossier.json'), 'utf8'));

const top = board.slice(0, 3).map((r) => `#${r.rank} ${r.slug} $${r.implied_value_usd.toLocaleString('en-US')}`).join(', ');
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: top implied values: ${top}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dash.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
