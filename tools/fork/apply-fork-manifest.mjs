#!/usr/bin/env node
/**
 * Build this fork's module.json from upstream's module.json.
 *
 * The fork never edits module.json by hand: on every upstream sync the
 * upstream manifest is taken as-is and the fork overlay below is applied, so
 * upstream changes (new packs, languages, relationships, ...) flow through
 * while the fork keeps its own identity, links and v12 compatibility.
 *
 * Usage:
 *   node tools/fork/apply-fork-manifest.mjs \
 *     --upstream <upstream module.json> \
 *     --current  <current fork module.json> \
 *     --out      <path to write> \
 *     [--version <x.y.z> | --bump]
 *
 * Without --version or --bump the fork's current version is kept.
 * --bump picks max(current fork version with patch + 1, upstream version), so
 * the published version always increases and Foundry offers the update.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const REPO = 'Aegis-plus/simulacrum-foundry-v12';
const REPO_URL = `https://github.com/${REPO}`;
const RAW_URL = `https://raw.githubusercontent.com/${REPO}`;
const UPSTREAM_URL = 'https://github.com/Daxiongmao87/simulacrum-foundry';
const LEGACY_STYLE = 'styles/simulacrum-legacy.css';
const FORK_AUTHOR = { name: 'Aegis-plus', url: 'https://github.com/Aegis-plus' };

const DESCRIPTION =
  '<p>An AI-powered Campaign Copilot for Foundry Virtual Tabletop that helps Game Masters manage their campaigns through natural language conversation.</p>' +
  `<p><strong>This is the Foundry VTT v12 build</strong>, a community fork of <a href="${UPSTREAM_URL}">Simulacrum</a> by Daxiongmao87 that adds v12 support. v13 and v14 behave exactly as upstream.</p>` +
  '<ul><li>Create, read, update, search and delete documents through chat</li><li>Compendium, asset search, schema introspection, macro and JavaScript tools</li><li>Confirmation and per-tool permissions for destructive operations</li><li>Any OpenAI-compatible endpoint with tool calling (OpenAI, Gemini, OpenRouter, Ollama, LM Studio, ...)</li><li>GM-only access</li></ul>' +
  `<p>See the <a href="${REPO_URL}#readme">README</a> for setup and model recommendations.</p>`;

export function parseVersion(version) {
  const parts = String(version)
    .split('.')
    .map(part => Number.parseInt(part, 10));
  if (parts.length === 0 || parts.some(Number.isNaN)) {
    throw new Error(`Unsupported version "${version}" (expected numeric dotted version)`);
  }
  return parts;
}

export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

export function bumpPatch(version) {
  const [major = 0, minor = 0, patch = 0] = parseVersion(version);
  return `${major}.${minor}.${patch + 1}`;
}

/** Next fork version: always newer than the current fork and never older than upstream. */
export function nextForkVersion(currentForkVersion, upstreamVersion) {
  const bumped = bumpPatch(currentForkVersion);
  return compareVersions(upstreamVersion, bumped) > 0 ? upstreamVersion : bumped;
}

export function applyForkOverlay(upstream, version) {
  const manifest = structuredClone(upstream);
  manifest.description = DESCRIPTION;
  manifest.version = version;

  const authors = Array.isArray(manifest.authors) ? manifest.authors : [];
  if (!authors.some(author => author?.name === FORK_AUTHOR.name)) authors.push(FORK_AUTHOR);
  manifest.authors = authors;

  manifest.compatibility = { ...(manifest.compatibility ?? {}), minimum: '12' };

  const styles = Array.isArray(manifest.styles) ? manifest.styles : [];
  if (!styles.includes(LEGACY_STYLE)) styles.push(LEGACY_STYLE);
  manifest.styles = styles;

  manifest.manifest = `${RAW_URL}/main/module.json`;
  manifest.download = `${RAW_URL}/release/${manifest.id}-${version}.zip`;
  manifest.url = REPO_URL;
  manifest.bugs = `${REPO_URL}/issues`;
  manifest.changelog = `${REPO_URL}/blob/main/CHANGELOG-v12.md`;
  manifest.readme = `${REPO_URL}/blob/main/README.md`;
  manifest.license = `${REPO_URL}/blob/main/LICENSE`;
  if (Array.isArray(manifest.media)) {
    manifest.media = manifest.media.map(item => ({
      ...item,
      url: String(item.url ?? '').replace(UPSTREAM_URL, REPO_URL),
    }));
  }
  return manifest;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--bump') args.bump = true;
    else if (key.startsWith('--')) args[key.slice(2)] = argv[++i];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.upstream || !args.current || !args.out) {
    console.error(
      'Usage: apply-fork-manifest.mjs --upstream <file> --current <file> --out <file> [--version x.y.z | --bump]'
    );
    process.exit(2);
  }
  const upstream = JSON.parse(readFileSync(args.upstream, 'utf8'));
  const current = JSON.parse(readFileSync(args.current, 'utf8'));
  let version = current.version;
  if (args.version) version = args.version;
  else if (args.bump) version = nextForkVersion(current.version, upstream.version);

  const manifest = applyForkOverlay(upstream, version);
  writeFileSync(args.out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(version);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
