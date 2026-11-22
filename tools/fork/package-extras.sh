#!/usr/bin/env bash
# Add fork-only files to a module package built by tools/package-module.js
# (that script is upstream's; the fork adds its extras here so it never has to
# patch it). Currently: the bundled Claude Code MCP server and its README.
#
# Usage: tools/fork/package-extras.sh <zip>
set -euo pipefail
ZIP=$(realpath "$1")
cd "$(dirname "$0")/../.."
[ -f mcp/foundry-mcp.mjs ] || { echo "mcp/foundry-mcp.mjs is missing; run (cd mcp && npm ci && npm run build)" >&2; exit 1; }
zip -q "$ZIP" mcp/foundry-mcp.mjs mcp/README.md
echo "Added MCP server to $(basename "$ZIP")"
