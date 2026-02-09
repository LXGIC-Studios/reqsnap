#!/usr/bin/env node

import https from "node:https";
import http from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { URL } from "node:url";

// ── ANSI Colors ──
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

const SNAP_DIR = ".reqsnap";

// ── Helpers ──
function printBanner(): void {
  console.log(`
${c.cyan}${c.bold}  ╔══════════════════════════════════╗
  ║        📸 reqsnap                 ║
  ║   API Response Snapshot & Diff    ║
  ╚══════════════════════════════════╝${c.reset}
`);
}

function printHelp(): void {
  printBanner();
  console.log(`${c.bold}USAGE${c.reset}
  ${c.cyan}reqsnap save${c.reset} <url>              Save a snapshot of the API response
  ${c.cyan}reqsnap check${c.reset} <url>             Check current response against saved snapshot
  ${c.cyan}reqsnap list${c.reset}                    List all saved snapshots
  ${c.cyan}reqsnap show${c.reset} <url>              Show a saved snapshot
  ${c.cyan}reqsnap delete${c.reset} <url>            Delete a saved snapshot

${c.bold}OPTIONS${c.reset}
  ${c.green}--help${c.reset}                       Show this help message
  ${c.green}--json${c.reset}                       Output results as JSON
  ${c.green}--method <method>${c.reset}             HTTP method (default: GET)
  ${c.green}--header <key:value>${c.reset}          Add request header (repeatable)
  ${c.green}--body <data>${c.reset}                 Request body for POST/PUT
  ${c.green}--ignore-fields <f1,f2>${c.reset}      Ignore fields in body diff (comma-separated)
  ${c.green}--ignore-headers${c.reset}              Don't diff headers
  ${c.green}--timeout <ms>${c.reset}                Request timeout (default: 10000)
  ${c.green}--dir <path>${c.reset}                  Snapshot directory (default: .reqsnap)

${c.bold}EXAMPLES${c.reset}
  ${c.dim}$ reqsnap save https://api.example.com/users${c.reset}
  ${c.dim}$ reqsnap check https://api.example.com/users${c.reset}
  ${c.dim}$ reqsnap check https://api.example.com/users --ignore-fields timestamp,updatedAt${c.reset}
  ${c.dim}$ reqsnap save https://api.example.com/data --method POST --body '{"q":"test"}'${c.reset}
`);
}

interface ParsedArgs {
  command: string;
  url: string | null;
  json: boolean;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  ignoreFields: string[];
  ignoreHeaders: boolean;
  timeout: number;
  dir: string;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    command: "",
    url: null,
    json: false,
    method: "GET",
    headers: {},
    body: null,
    ignoreFields: [],
    ignoreHeaders: false,
    timeout: 10000,
    dir: SNAP_DIR,
    help: false,
  };

  let positional = 0;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        result.help = true;
        break;
      case "--json":
        result.json = true;
        break;
      case "--ignore-headers":
        result.ignoreHeaders = true;
        break;
      case "--method":
      case "-m":
        result.method = (argv[++i] || "GET").toUpperCase();
        break;
      case "--header":
      case "-H": {
        const hdr = argv[++i] || "";
        const idx = hdr.indexOf(":");
        if (idx > 0) {
          result.headers[hdr.slice(0, idx).trim()] = hdr.slice(idx + 1).trim();
        }
        break;
      }
      case "--body":
      case "-d":
        result.body = argv[++i] || null;
        break;
      case "--ignore-fields":
        result.ignoreFields = (argv[++i] || "").split(",").map((f) => f.trim()).filter(Boolean);
        break;
      case "--timeout":
      case "-t":
        result.timeout = parseInt(argv[++i], 10) || 10000;
        break;
      case "--dir":
        result.dir = argv[++i] || SNAP_DIR;
        break;
      default:
        if (!arg.startsWith("-")) {
          if (positional === 0) result.command = arg;
          else if (positional === 1) result.url = arg;
          positional++;
        }
        break;
    }
  }

  return result;
}

function urlToFilename(url: string, method: string): string {
  const hash = createHash("md5").update(`${method}:${url}`).digest("hex").slice(0, 12);
  const parsed = new URL(url);
  const safeName = parsed.hostname.replace(/[^a-zA-Z0-9]/g, "_");
  return `${safeName}_${hash}.json`;
}

interface Snapshot {
  url: string;
  method: string;
  status: number;
  headers: Record<string, string>;
  body: any;
  timestamp: string;
  bodyRaw?: string;
}

async function fetchUrl(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | null,
  timeout: number
): Promise<Snapshot> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;

    const opts = {
      method,
      headers: {
        "User-Agent": "reqsnap/1.0.0",
        ...headers,
      },
      timeout,
    };

    const req = client.request(url, opts, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const rawBody = Buffer.concat(chunks).toString("utf-8");
        let parsedBody: any = rawBody;

        try {
          parsedBody = JSON.parse(rawBody);
        } catch {
          // Not JSON, keep as string
        }

        const responseHeaders: Record<string, string> = {};
        for (const [key, val] of Object.entries(res.headers)) {
          if (val) responseHeaders[key] = Array.isArray(val) ? val.join(", ") : val;
        }

        resolve({
          url,
          method,
          status: res.statusCode || 0,
          headers: responseHeaders,
          body: parsedBody,
          bodyRaw: rawBody,
          timestamp: new Date().toISOString(),
        });
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Timeout after ${timeout}ms`));
    });

    if (body) req.write(body);
    req.end();
  });
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function saveSnapshot(dir: string, snap: Snapshot): string {
  ensureDir(dir);
  const filename = urlToFilename(snap.url, snap.method);
  const filepath = path.join(dir, filename);
  const toSave = { ...snap };
  delete toSave.bodyRaw;
  writeFileSync(filepath, JSON.stringify(toSave, null, 2));
  return filepath;
}

function loadSnapshot(dir: string, url: string, method: string): Snapshot | null {
  const filename = urlToFilename(url, method);
  const filepath = path.join(dir, filename);
  if (!existsSync(filepath)) return null;
  return JSON.parse(readFileSync(filepath, "utf-8"));
}

interface DiffItem {
  path: string;
  type: "added" | "removed" | "changed";
  oldValue?: any;
  newValue?: any;
  breaking: boolean;
}

function deepDiff(
  oldObj: any,
  newObj: any,
  pathPrefix: string,
  ignoreFields: string[]
): DiffItem[] {
  const diffs: DiffItem[] = [];

  if (typeof oldObj !== typeof newObj) {
    diffs.push({
      path: pathPrefix || "(root)",
      type: "changed",
      oldValue: typeof oldObj,
      newValue: typeof newObj,
      breaking: true,
    });
    return diffs;
  }

  if (oldObj === null || newObj === null || typeof oldObj !== "object") {
    if (oldObj !== newObj) {
      diffs.push({
        path: pathPrefix || "(root)",
        type: "changed",
        oldValue: oldObj,
        newValue: newObj,
        breaking: false,
      });
    }
    return diffs;
  }

  if (Array.isArray(oldObj) && Array.isArray(newObj)) {
    const maxLen = Math.max(oldObj.length, newObj.length);
    for (let i = 0; i < maxLen; i++) {
      const p = `${pathPrefix}[${i}]`;
      if (i >= oldObj.length) {
        diffs.push({ path: p, type: "added", newValue: newObj[i], breaking: false });
      } else if (i >= newObj.length) {
        diffs.push({ path: p, type: "removed", oldValue: oldObj[i], breaking: true });
      } else {
        diffs.push(...deepDiff(oldObj[i], newObj[i], p, ignoreFields));
      }
    }
    return diffs;
  }

  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
  for (const key of allKeys) {
    if (ignoreFields.includes(key)) continue;

    const p = pathPrefix ? `${pathPrefix}.${key}` : key;
    if (!(key in oldObj)) {
      diffs.push({ path: p, type: "added", newValue: newObj[key], breaking: false });
    } else if (!(key in newObj)) {
      diffs.push({ path: p, type: "removed", oldValue: oldObj[key], breaking: true });
    } else {
      diffs.push(...deepDiff(oldObj[key], newObj[key], p, ignoreFields));
    }
  }

  return diffs;
}

function printDiffs(diffs: DiffItem[]): void {
  if (diffs.length === 0) {
    console.log(`  ${c.green}✓ No differences found${c.reset}\n`);
    return;
  }

  const breaking = diffs.filter((d) => d.breaking);
  const nonBreaking = diffs.filter((d) => !d.breaking);

  if (breaking.length > 0) {
    console.log(`  ${c.red}${c.bold}⚠ BREAKING CHANGES (${breaking.length})${c.reset}\n`);
    for (const diff of breaking) {
      const icon = diff.type === "removed" ? "−" : "~";
      console.log(`    ${c.red}${icon} ${diff.path}${c.reset}`);
      if (diff.oldValue !== undefined)
        console.log(`      ${c.dim}was: ${JSON.stringify(diff.oldValue)}${c.reset}`);
      if (diff.newValue !== undefined)
        console.log(`      ${c.dim}now: ${JSON.stringify(diff.newValue)}${c.reset}`);
    }
    console.log();
  }

  if (nonBreaking.length > 0) {
    console.log(`  ${c.yellow}Changes (${nonBreaking.length})${c.reset}\n`);
    for (const diff of nonBreaking) {
      const icon = diff.type === "added" ? "+" : "~";
      const color = diff.type === "added" ? c.green : c.yellow;
      console.log(`    ${color}${icon} ${diff.path}${c.reset}`);
      if (diff.oldValue !== undefined)
        console.log(`      ${c.dim}was: ${JSON.stringify(diff.oldValue)}${c.reset}`);
      if (diff.newValue !== undefined)
        console.log(`      ${c.dim}now: ${JSON.stringify(diff.newValue)}${c.reset}`);
    }
    console.log();
  }
}

async function cmdSave(args: ParsedArgs): Promise<void> {
  if (!args.url) {
    console.error(`${c.red}Error: URL is required. Usage: reqsnap save <url>${c.reset}`);
    process.exit(1);
  }

  if (!args.json) console.log(`  ${c.cyan}Fetching${c.reset} ${args.url}...\n`);

  const snap = await fetchUrl(args.url, args.method, args.headers, args.body, args.timeout);
  const filepath = saveSnapshot(args.dir, snap);

  if (args.json) {
    console.log(JSON.stringify({ saved: true, path: filepath, snapshot: snap }, null, 2));
  } else {
    console.log(`  ${c.green}✓ Snapshot saved${c.reset}`);
    console.log(`    Status: ${c.bold}${snap.status}${c.reset}`);
    console.log(`    Headers: ${c.dim}${Object.keys(snap.headers).length} fields${c.reset}`);
    console.log(`    Body type: ${c.dim}${typeof snap.body === "object" ? "JSON" : "text"}${c.reset}`);
    console.log(`    File: ${c.dim}${filepath}${c.reset}\n`);
  }
}

async function cmdCheck(args: ParsedArgs): Promise<void> {
  if (!args.url) {
    console.error(`${c.red}Error: URL is required. Usage: reqsnap check <url>${c.reset}`);
    process.exit(1);
  }

  const saved = loadSnapshot(args.dir, args.url, args.method);
  if (!saved) {
    console.error(
      `${c.red}Error: No snapshot found for ${args.url}. Run 'reqsnap save ${args.url}' first.${c.reset}`
    );
    process.exit(1);
  }

  if (!args.json) console.log(`  ${c.cyan}Checking${c.reset} ${args.url} against snapshot...\n`);

  const current = await fetchUrl(args.url, args.method, args.headers, args.body, args.timeout);

  const allDiffs: DiffItem[] = [];

  // Status diff
  if (saved.status !== current.status) {
    allDiffs.push({
      path: "status",
      type: "changed",
      oldValue: saved.status,
      newValue: current.status,
      breaking: true,
    });
  }

  // Header diffs
  if (!args.ignoreHeaders) {
    const headerDiffs = deepDiff(saved.headers, current.headers, "headers", args.ignoreFields);
    allDiffs.push(...headerDiffs);
  }

  // Body diffs
  const bodyDiffs = deepDiff(saved.body, current.body, "body", args.ignoreFields);
  allDiffs.push(...bodyDiffs);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          url: args.url,
          method: args.method,
          snapshotTimestamp: saved.timestamp,
          currentTimestamp: current.timestamp,
          identical: allDiffs.length === 0,
          breakingChanges: allDiffs.filter((d) => d.breaking).length,
          totalChanges: allDiffs.length,
          diffs: allDiffs,
        },
        null,
        2
      )
    );
  } else {
    console.log(`  ${c.dim}Snapshot from: ${saved.timestamp}${c.reset}`);
    console.log(`  ${c.dim}Current check: ${current.timestamp}${c.reset}\n`);
    printDiffs(allDiffs);

    if (allDiffs.some((d) => d.breaking)) {
      console.log(`  ${c.red}${c.bold}Result: BREAKING CHANGES DETECTED${c.reset}\n`);
    } else if (allDiffs.length > 0) {
      console.log(`  ${c.yellow}${c.bold}Result: Changes detected (non-breaking)${c.reset}\n`);
    } else {
      console.log(`  ${c.green}${c.bold}Result: No changes. API response matches snapshot.${c.reset}\n`);
    }
  }

  if (allDiffs.some((d) => d.breaking)) process.exit(1);
}

function cmdList(args: ParsedArgs): void {
  if (!existsSync(args.dir)) {
    console.log(`  ${c.dim}No snapshots found. Run 'reqsnap save <url>' to create one.${c.reset}\n`);
    return;
  }

  const { readdirSync } = require("fs");
  const files = readdirSync(args.dir).filter((f: string) => f.endsWith(".json"));

  if (files.length === 0) {
    console.log(`  ${c.dim}No snapshots found.${c.reset}\n`);
    return;
  }

  const snapshots = files.map((f: string) => {
    const snap = JSON.parse(readFileSync(path.join(args.dir, f), "utf-8"));
    return { file: f, url: snap.url, method: snap.method, timestamp: snap.timestamp, status: snap.status };
  });

  if (args.json) {
    console.log(JSON.stringify(snapshots, null, 2));
  } else {
    console.log(`  ${c.bold}Saved snapshots (${snapshots.length})${c.reset}\n`);
    for (const snap of snapshots) {
      console.log(`    ${c.cyan}${snap.method}${c.reset} ${snap.url}`);
      console.log(`      Status: ${snap.status}  |  Saved: ${c.dim}${snap.timestamp}${c.reset}`);
    }
    console.log();
  }
}

function cmdShow(args: ParsedArgs): void {
  if (!args.url) {
    console.error(`${c.red}Error: URL is required. Usage: reqsnap show <url>${c.reset}`);
    process.exit(1);
  }

  const snap = loadSnapshot(args.dir, args.url, args.method);
  if (!snap) {
    console.error(`${c.red}Error: No snapshot found for ${args.url}.${c.reset}`);
    process.exit(1);
  }

  if (args.json) {
    console.log(JSON.stringify(snap, null, 2));
  } else {
    console.log(`  ${c.bold}Snapshot: ${snap.url}${c.reset}`);
    console.log(`  Method: ${snap.method}  |  Status: ${snap.status}  |  Saved: ${snap.timestamp}\n`);
    console.log(`  ${c.bold}Headers:${c.reset}`);
    for (const [key, val] of Object.entries(snap.headers)) {
      console.log(`    ${c.cyan}${key}:${c.reset} ${val}`);
    }
    console.log(`\n  ${c.bold}Body:${c.reset}`);
    console.log(`    ${JSON.stringify(snap.body, null, 2).split("\n").join("\n    ")}\n`);
  }
}

function cmdDelete(args: ParsedArgs): void {
  if (!args.url) {
    console.error(`${c.red}Error: URL is required. Usage: reqsnap delete <url>${c.reset}`);
    process.exit(1);
  }

  const filename = urlToFilename(args.url, args.method);
  const filepath = path.join(args.dir, filename);

  if (!existsSync(filepath)) {
    console.error(`${c.red}Error: No snapshot found for ${args.url}.${c.reset}`);
    process.exit(1);
  }

  const { unlinkSync } = require("fs");
  unlinkSync(filepath);

  if (args.json) {
    console.log(JSON.stringify({ deleted: true, url: args.url }));
  } else {
    console.log(`  ${c.green}✓ Snapshot deleted for ${args.url}${c.reset}\n`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.command) {
    printHelp();
    process.exit(1);
  }

  if (!args.json) printBanner();

  switch (args.command) {
    case "save":
      await cmdSave(args);
      break;
    case "check":
      await cmdCheck(args);
      break;
    case "list":
      cmdList(args);
      break;
    case "show":
      cmdShow(args);
      break;
    case "delete":
      cmdDelete(args);
      break;
    default:
      console.error(`${c.red}Unknown command: ${args.command}. Use --help for usage.${c.reset}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`${c.red}Fatal error: ${err.message}${c.reset}`);
  process.exit(1);
});
