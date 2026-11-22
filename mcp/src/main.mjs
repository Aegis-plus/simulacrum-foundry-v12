#!/usr/bin/env node
/**
 * Foundry VTT MCP server (Simulacrum).
 *
 * Claude Code starts this over stdio. It listens on 127.0.0.1 for the
 * Simulacrum module in the Game Master's browser and relays tool calls.
 *
 * Environment:
 *   FOUNDRY_MCP_TOKEN       required; must match the token in Foundry's Simulacrum settings
 *   FOUNDRY_MCP_PORT        default 47391
 *   FOUNDRY_MCP_TIMEOUT_MS  per tool call, default 120000
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { FoundryBridge } from './bridge.mjs';
import { createMcpServer } from './server.mjs';

// stdout carries the MCP protocol; everything human-readable goes to stderr.
const log = message => process.stderr.write(`[foundry-mcp] ${message}\n`);

const port = Number.parseInt(process.env.FOUNDRY_MCP_PORT ?? '47391', 10);
const requestTimeoutMs = Number.parseInt(process.env.FOUNDRY_MCP_TIMEOUT_MS ?? '120000', 10);
const token = (process.env.FOUNDRY_MCP_TOKEN ?? '').trim();
if (!token) log('FOUNDRY_MCP_TOKEN is not set; Foundry will not be able to connect.');

const bridge = new FoundryBridge({ token, port, requestTimeoutMs, log });
const server = createMcpServer(bridge);

await bridge.start();
await server.connect(new StdioServerTransport());

const shutdown = async () => {
  await bridge.stop().catch(() => {});
  process.exit(0);
};
process.stdin.on('close', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
