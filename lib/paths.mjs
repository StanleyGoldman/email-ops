// Every path resolves from this checkout, never from the current directory, so
// the dev repo and a deployment each use their own config, profile and data.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// EMAIL_OPS_DATA_DIR exists so the test suite can write somewhere disposable.
export const DATA = process.env.EMAIL_OPS_DATA_DIR
  ? resolve(process.env.EMAIL_OPS_DATA_DIR)
  : join(ROOT, 'data');

export const PROFILE = join(ROOT, 'modes', '_profile.md');
export const LOCAL_CONFIG = join(ROOT, 'config', 'himalaya.toml');
export const DRAFTS = join(DATA, 'drafts');
export const PROPOSALS = join(DATA, 'proposals');
export const ACTIONS_LOG = join(DATA, 'actions.jsonl');
