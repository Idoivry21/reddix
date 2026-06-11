#!/usr/bin/env node
// Reddix launcher: build the SPA on first run if needed, then start the
// single-process server that serves the built UI and the API together.
// Used both for `npx github:Idoivry21/reddix` and for a global install.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the package root from this file's location, never the caller's cwd:
// `npx github:...` and global installs run the bin from an unrelated directory.
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const builtIndex = path.join(packageRoot, 'dist', 'index.html');

// npm is `npm.cmd` on Windows; the script runner is the same name otherwise.
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(args, label) {
  const result = spawnSync(npm, args, {
    cwd: packageRoot,
    stdio: 'inherit',
    // Pin the static dir to the package's own build so the data dir (which
    // defaults relative to cwd) and the UI never depend on where the user ran.
    env: { ...process.env, REDDIX_STATIC_DIR: path.join(packageRoot, 'dist') }
  });
  if (result.error) {
    console.error(`reddix: failed to ${label}: ${result.error.message}`);
    process.exit(1);
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
}

// dist/ is git-ignored, so a fresh clone or npx checkout has no build yet.
if (!existsSync(builtIndex)) {
  console.log('reddix: building the UI (first run)…');
  run(['run', 'build'], 'build the UI');
}

run(['run', 'start'], 'start the server');
