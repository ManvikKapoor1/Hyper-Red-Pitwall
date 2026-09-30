#!/bin/bash
# SessionStart hook for Claude Code on the web: install npm dependencies so
# `npm test`, `npm run typecheck` and `npm run build` work straight away.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# npm install (not ci) so the cached container keeps node_modules between sessions
npm install --no-audit --no-fund --loglevel=error
