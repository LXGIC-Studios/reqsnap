# @lxgicstudios/reqsnap

[![npm version](https://img.shields.io/npm/v/@lxgicstudios/reqsnap)](https://www.npmjs.com/package/@lxgicstudios/reqsnap)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-blue)](https://www.npmjs.com/package/@lxgicstudios/reqsnap)

Snapshot API responses and diff them against previous saves. Catch breaking changes in status codes, headers, and response bodies before they hit production.

**Zero external dependencies.** Uses only Node.js builtins.

## Install

```bash
npm install -g @lxgicstudios/reqsnap
```

Or run directly:

```bash
npx @lxgicstudios/reqsnap save https://api.example.com/users
```

## Usage

### Save a snapshot

```bash
reqsnap save https://api.example.com/users
```

This captures the status code, headers, and body. Snapshots are stored in `.reqsnap/`.

### Check against snapshot

```bash
reqsnap check https://api.example.com/users
```

Compares the live response to your saved snapshot. Shows added, removed, and changed fields. Flags breaking changes.

### Ignore volatile fields

```bash
reqsnap check https://api.example.com/users --ignore-fields timestamp,updatedAt,requestId
```

### List saved snapshots

```bash
reqsnap list
```

### Show a snapshot

```bash
reqsnap show https://api.example.com/users
```

### Delete a snapshot

```bash
reqsnap delete https://api.example.com/users
```

### POST requests

```bash
reqsnap save https://api.example.com/search --method POST --body '{"q":"test"}'
```

## Features

- Save complete API response snapshots (status, headers, body)
- Deep diff with breaking change detection
- Ignore volatile fields like timestamps and request IDs
- Support for any HTTP method (GET, POST, PUT, DELETE, etc.)
- Custom headers and request bodies
- Colorful terminal output with clear diff display
- JSON output mode for CI/CD integration
- Multiple snapshot management (list, show, delete)
- Non-zero exit code on breaking changes
- Works with JSON and non-JSON responses

## Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--help` | `-h` | Show help message | |
| `--json` | | Output results as JSON | `false` |
| `--method <method>` | `-m` | HTTP method | `GET` |
| `--header <key:value>` | `-H` | Add request header (repeatable) | |
| `--body <data>` | `-d` | Request body | |
| `--ignore-fields <f1,f2>` | | Ignore fields in body diff | |
| `--ignore-headers` | | Skip header comparison | `false` |
| `--timeout <ms>` | `-t` | Request timeout | `10000` |
| `--dir <path>` | | Snapshot directory | `.reqsnap` |

## Commands

| Command | Description |
|---------|-------------|
| `save <url>` | Save a snapshot of the API response |
| `check <url>` | Compare live response against saved snapshot |
| `list` | List all saved snapshots |
| `show <url>` | Display a saved snapshot |
| `delete <url>` | Remove a saved snapshot |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | No breaking changes detected |
| `1` | Breaking changes found or error occurred |

---

**Built by [LXGIC Studios](https://lxgicstudios.com)**

[GitHub](https://github.com/lxgicstudios/reqsnap) | [Twitter](https://x.com/lxgicstudios)
