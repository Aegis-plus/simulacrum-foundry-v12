# Claude Code (MCP) bridge for Foundry VTT

Connect [Claude Code](https://claude.com/claude-code), or any other [MCP](https://modelcontextprotocol.io)
client, to a live Foundry VTT world. Claude Code can then search, read, create, update and delete
documents, inspect the game system's schemas, browse compendiums and assets, and run macros, using
the same tools as Simulacrum's own chat.

Works with Foundry VTT v12, v13 and v14.

## How it works

```
Claude Code  --stdio-->  foundry-mcp.mjs  <--ws://127.0.0.1:47391--  Foundry (GM's browser, Simulacrum)
```

- Claude Code starts `foundry-mcp.mjs`, the MCP server bundled in this module.
- The Simulacrum module in the Game Master's browser connects out to it on `127.0.0.1` and runs each
  tool call against the open world.
- Both sides share a token, so no other web page or program can pretend to be your Foundry world.

Claude Code, Node.js, and the browser (or the Foundry desktop app) with the world open as GM must be
on the **same computer**.

## Setup

You need Node.js 18 or newer (`node --version`). If you installed Claude Code with npm, you already have it.

1. Update Simulacrum to 1.2.0 or newer.
2. In Foundry, open the world as a Game Master and go to **Game Settings → Configure Settings →
   Simulacrum → Connect Claude Code**.
3. Tick **Enable bridge**. A token is generated.
4. Copy the command shown and run it in a terminal. It looks like:

   ```bash
   claude mcp add foundry -s user -e FOUNDRY_MCP_TOKEN=<token> -- node "$HOME/.local/share/FoundryVTT/Data/modules/simulacrum/mcp/foundry-mcp.mjs"
   ```

   The path is the default Foundry data folder for your OS. If your data folder is elsewhere, use
   `<your data folder>/Data/modules/simulacrum/mcp/foundry-mcp.mjs`. In Foundry's setup screen,
   **Configuration → User Data Path** shows the data folder.

5. Start (or restart) Claude Code. Within a few seconds the status in Foundry turns green:
   **Connected to Claude Code**.

Check it by asking Claude Code: _"Call get_world_context and tell me about my Foundry world."_
`claude mcp list` should show `foundry ... ✓ Connected`.

## Tools

| Tool                                                       | What it does                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `foundry_status`                                           | Whether a world is connected; works even when it is not                               |
| `get_world_context`                                        | World, system and versions, document types, counts, compendiums, active scene, macros |
| `search_documents`, `list_documents`, `read_document`      | Find and read documents, including in compendiums                                     |
| `list_document_schemas`, `inspect_document_schema`         | The game system's document types and fields                                           |
| `create_document`, `update_document`, `delete_document`    | Change the world                                                                      |
| `document_copy`, `document_move`, `set_document_ownership` | Copy, move between folders/compendiums, set ownership                                 |
| `search_assets`, `browse_folders`                          | Find images, audio and other files                                                    |
| `execute_macro`, `run_javascript`                          | Run a macro or a script in the GM's browser                                           |
| `read_tool_output`                                         | Read the rest of a large result that was returned as a preview                        |

Macros that define a Simulacrum tool (see the main README) are offered too.

## Safety

- Claude Code asks before using tools, unless you allow them. Read-only tools are marked as such;
  tools that change the world are marked destructive.
- Tools you set to **Never** in Simulacrum's **Tool Permissions** are not offered to Claude Code, and
  are refused if called.
- `run_javascript` and `execute_macro` run code in your browser with GM rights. Approve them with care.
- The server only listens on `127.0.0.1`. Generate a new token in the bridge settings if it leaks,
  then run the updated command.

## Options

Set these with `-e NAME=value` in the `claude mcp add` command:

| Variable                 | Default    |                                            |
| ------------------------ | ---------- | ------------------------------------------ |
| `FOUNDRY_MCP_TOKEN`      | (required) | Must match the token in Foundry            |
| `FOUNDRY_MCP_PORT`       | `47391`    | Change it in Foundry's bridge settings too |
| `FOUNDRY_MCP_TIMEOUT_MS` | `120000`   | How long one tool call may take            |

## Troubleshooting

- **Status stays "Waiting for Claude Code"**: Claude Code is not running, or the server was not
  added. Run `claude mcp list`. If it shows an error, check the path to `foundry-mcp.mjs` and that
  `node` works in your terminal.
- **"Token mismatch"**: the token in Foundry changed. Copy the command again, run
  `claude mcp remove foundry -s user`, then add it again and restart Claude Code.
- **Port in use**: only one Claude Code session can be connected at a time. Close the other
  session, or use a different port on both sides.
- **Foundry on another computer, or The Forge**: not supported. The browser with the world open
  and Claude Code must be on the same computer.

## Development

The server source is in `src/`. `npm install && npm run build` bundles it into `foundry-mcp.mjs`
(committed, so the module ships it without a build step); `npm test` runs an end-to-end test of the
real Foundry-side bridge (`scripts/mcp/mcp-bridge.js`) against the bundled server through the MCP
client SDK.
