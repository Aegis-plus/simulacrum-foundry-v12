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

### World and documents

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

### Running the game

These also work in Simulacrum's own sidebar chat. The D&D 5e ones use the dnd5e system's own rolls
and rules (proficiency, advantage, resistances, spell slots).

| Tool               | What it does                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roll_dice`        | Roll any formula into chat: public, GM-only, blind or self                                                                                              |
| `roll_check`       | 5e skill/ability/tool checks, saves, death saves and concentration, with advantage and a DC; one actor or a group                                       |
| `roll_initiative`  | Initiative for NPCs, everyone, the unrolled, or named combatants                                                                                        |
| `use_item`         | Use a weapon, spell or feature: post its card, attack (hit/miss against target AC), roll damage, or attack and damage in one go, optionally applying it |
| `roll_table`       | Draw from a roll table                                                                                                                                  |
| `post_message`     | Narrate, speak in character as an actor or token, emote, or post out of character; can whisper                                                          |
| `read_chat`        | Recent chat including who spoke and roll totals                                                                                                         |
| `show_handout`     | Show a journal entry/page or an image to players                                                                                                        |
| `combat_start`     | Start an encounter from tokens (all, hostile, a list), roll NPC initiative, begin round 1                                                               |
| `combat_status`    | Round, whose turn, order with HP and conditions                                                                                                         |
| `combat_control`   | Next/previous turn or round, start, end, add/remove combatants, set initiative, mark defeated                                                           |
| `list_tokens`      | Tokens with grid position, disposition, HP, size, conditions, hidden state                                                                              |
| `move_token`       | Move to a square, next to a token, or N feet in a direction                                                                                             |
| `place_token`      | Spawn actors (one or many, hidden or not; compendium actors are imported)                                                                               |
| `remove_token`     | Delete tokens (marked destructive)                                                                                                                      |
| `set_token_hidden` | Hide or reveal tokens                                                                                                                                   |
| `get_distance`     | Distance between tokens, 5e style (edge to edge, diagonals as one square)                                                                               |
| `activate_scene`   | Move everyone to a scene, or just view it                                                                                                               |
| `pan_to`           | Ping a token or square and pull everyone's view there                                                                                                   |
| `toggle_door`      | List doors, or open/close/lock/unlock one                                                                                                               |
| `get_actor_status` | Compact sheet: HP, AC, abilities and saves, slots, resources, conditions, items, currency, XP                                                           |
| `apply_damage`     | Typed damage (resistances apply), healing or temp HP; NPCs at 0 HP are marked defeated                                                                  |
| `set_condition`    | Add/remove conditions; set exhaustion                                                                                                                   |
| `rest`             | 5e short or long rest                                                                                                                                   |
| `award`            | XP and currency to the party, each or split, announced in chat                                                                                          |
| `advance_time`     | Move the world clock forward, or read it                                                                                                                |
| `play_audio`       | List, play or stop playlists and sounds, or play a file                                                                                                 |

Positions are grid squares counted from the map's top-left square (`col`, `row`). Names that match
several things (three tokens called "Goblin") return an error listing their ids, so nothing is
done to the wrong one.

**Solo play tip:** start a Claude Code session with something like _"You are the Game Master for my
solo campaign. My character is Brenna. Call get_world_context, roll every die in Foundry, run the
monsters' turns, never reveal what my character hasn't discovered, and keep a Campaign Log journal
updated."_ Allow the read-only tools permanently in Claude Code so you are only asked about actions.

## Safety

- Claude Code asks before using tools, unless you allow them. Read-only tools are marked as such;
  tools that delete things are marked destructive.
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
