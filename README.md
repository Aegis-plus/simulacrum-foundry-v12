# Simulacrum: AI Campaign Copilot (Foundry VTT v12 build)

<p align="center">
  <img src="https://img.shields.io/badge/dynamic/json?label=version&query=version&url=https%3A%2F%2Fraw.githubusercontent.com%2FAegis-plus%2Fsimulacrum-foundry-v12%2Fmain%2Fmodule.json" alt="Version">
  <img src="https://img.shields.io/badge/Foundry-v12%20%7C%20v13%20%7C%20v14-e67e22" alt="Foundry v12 | v13 | v14">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Aegis-plus/simulacrum-foundry-v12" alt="License"></a>
</p>

> [!NOTE]
> This is a community fork of [Simulacrum](https://github.com/Daxiongmao87/simulacrum-foundry) by [Daxiongmao87](https://github.com/Daxiongmao87)
> that adds **Foundry VTT v12** support. The upstream module requires v13 or newer.
> v13 and v14 keep working exactly as upstream. See [Foundry v12 support](#foundry-v12-support) below.

An AI-powered Campaign Copilot for [Foundry Virtual Tabletop](https://foundryvtt.com/) that helps Game Masters manage their campaigns through natural language conversation.

<p align="center">
  <a href="https://www.youtube.com/watch?v=tu1EZ57aNW8"><strong>Video: Grunk Test</strong></a><br>
  <img src="assets/simulacrum-demo.gif" alt="Simulacrum AI Assistant Demo" width="600">
</p>

## What is Simulacrum?

Simulacrum is an intelligent agent that lives inside your Foundry VTT sidebar. Unlike simple text generators, Simulacrum is a **Campaign Copilot**—it can understand your requests, plan multi-step operations, and directly interact with your game world.

**Ask it to:**
- Create NPCs, items, journal entries, and other documents
- Search and read existing campaign content
- Update documents with new information
- Execute complex multi-step tasks
- Run custom macros and JavaScript automation

## Features

### Intelligent Document Management
Simulacrum understands Foundry VTT's document structure. Create an actor, and it knows about abilities, items, and system-specific fields. Ask for a magic sword, and it builds one with proper stats.

### Extensible Tool System
The AI uses a set of tools to interact with your world:
- **Document Tools**: Create, read, update, delete, search, and list documents
- **Compendium Tools**: Lock/unlock packs, manage document ownership
- **Asset Search**: Find images, audio, and other assets in your data
- **Schema Introspection**: Understands your game system's data structures
- **Macro Execution**: Run any macro in your world
- **JavaScript Execution**: Advanced automation capabilities

### Tool Permission Controls
Destructive operations (update, delete, macro/JS execution) require confirmation before executing. Configure per-tool permissions with Allow, Deny, Always Allow, or Blacklist options.

### Task Tracking
For complex operations, Simulacrum can create and manage tasks, tracking progress across multiple steps and reporting when complete.

### Multi-Provider Support
Connect to any OpenAI-compatible API endpoint:
- OpenAI (GPT-4o, etc.)
- Google Gemini (via [OpenAI-compatible endpoint](https://ai.google.dev/gemini-api/docs/openai))
- Anthropic Claude (via proxy or OpenRouter)
- OpenRouter, LLM7, and other aggregators
- Local models (Ollama, LM Studio, etc.)

### GM-Only Access
Simulacrum is restricted to Game Masters only—players cannot access the AI interface or execute commands.

## Installation

> [!IMPORTANT]
> Searching for "Simulacrum" in Foundry's **Install Module** dialog installs the upstream module,
> which does not run on v12. Use the manifest URL below to install this build.

### Manifest URL (recommended)
1. Open Foundry VTT and navigate to **Add-on Modules**
2. Click **Install Module**
3. Paste this into the **Manifest URL** field and click **Install**:
   ```
   https://raw.githubusercontent.com/Aegis-plus/simulacrum-foundry-v12/main/module.json
   ```

This build uses the same module id (`simulacrum`) as upstream, so it replaces an existing
Simulacrum install rather than sitting alongside it.

### Manual Installation
1. Download [`simulacrum-1.1.1.zip`](https://raw.githubusercontent.com/Aegis-plus/simulacrum-foundry-v12/release/simulacrum-1.1.1.zip) (built packages live on the [`release` branch](https://github.com/Aegis-plus/simulacrum-foundry-v12/tree/release))
2. Extract it to your `Data/modules/simulacrum/` directory
3. Restart Foundry VTT

## Foundry v12 support

Upstream Simulacrum builds its sidebar on v13's `AbstractSidebarTab`, which does not exist in v12.
This fork adds a compatibility layer that is only used on v12:

- **Sidebar tab:** `scripts/ui/legacy-sidebar-tab.js` provides the parts of v13's sidebar tab API the
  chat panel needs, built on v12's ApplicationV2. On v12 the Simulacrum button is added to the sidebar
  just before Settings (GMs only).
- **Pop-out:** right-click the Simulacrum tab button (or click it while the sidebar is collapsed) to open
  the panel in its own window, like the built-in v12 tabs.
- **API shims:** `scripts/utils/foundry-compat.js` resolves `renderTemplate`, `loadTemplates` and
  `buildUuid` for each core version.
- **Styling:** `styles/simulacrum-legacy.css` supplies the chat-panel layout v13 core provides. All of its
  rules are scoped to the v12 tab, so v13/v14 are unaffected.

**Known limitations on v12:** the v12 layout and styling were written without v13's core chat styles to
build on, and have had less real-world testing than v13/v14. Please report anything that looks or
behaves wrong on v12 in this repository's [issues](https://github.com/Aegis-plus/simulacrum-foundry-v12/issues).

### Staying up to date with upstream

A daily GitHub Action brings new commits from the [original repository](https://github.com/Daxiongmao87/simulacrum-foundry)
into this fork, runs the test suite, and publishes a new package. Foundry then offers the update as usual.
If an upstream change conflicts with the v12 changes, nothing is published and an issue is opened instead.
Details are in [fork/README.md](fork/README.md); fork-specific changes are listed in [CHANGELOG-v12.md](CHANGELOG-v12.md).

## Configuration

1. Enable the module in your world
2. Open **Module Settings** → **Simulacrum**
3. Configure your API Base URL and API Key
4. Access Simulacrum from the sidebar tab
5. Select a model from the dropdown in the sidebar header

### Required Settings
- **API Base URL**: Your provider's OpenAI-compatible endpoint (e.g., `https://api.openai.com/v1`)
- **API Key**: Your provider's API key

The model selector in the sidebar automatically fetches available models from your configured endpoint.

For detailed setup instructions, including free tier options and troubleshooting, see the **[Getting Started Guide](docs/GETTING-STARTED.md)**.

## Usage

Click the Simulacrum tab in the sidebar and start chatting. Examples:

> "Create a goblin warrior named Grunk with 15 HP and a rusty shortsword"

> "Find all journal entries about the Kingdom of Eldoria"

> "Update the Dragon's Lair scene to add a treasure hoard in the corner"

> "Create a task to build out the entire merchant guild, including 5 NPCs and their shop inventory"

## Extending Simulacrum

### Custom Macro Tools

You can create custom tools for Simulacrum by creating a standard Foundry VTT Macro. To expose a macro as a tool, add a `const tool` configuration object to your macro code:

```javascript
// Tool Configuration - This tells Simulacrum how to use this macro
const tool = {
    name: "my_custom_tool",
    description: "A description of what this tool does",
    parameters: {
        type: "object",
        properties: {
            parameterName: {
                type: "string",
                description: "Description of the parameter"
            }
        },
        required: ["parameterName"]
    },
    enabled: true
};

// Your macro logic here
// Access parameters via: this.args.parameterName
const result = `Processed: ${this.args.parameterName}`;

// Return a value to send output back to the AI
return result;
```

**Important notes:**
- A `response` parameter is automatically added to all macro-tools, allowing the AI to explain what it's doing to the user
- **Return a value** from your macro to provide output to the AI (strings or objects work)
- If you don't return anything, the AI sees "No output"
- Simulacrum automatically discovers any macro with this configuration and makes it available to the AI

### JavaScript Execution
For advanced users, Simulacrum can execute arbitrary JavaScript, enabling complex automation workflows.

## Requirements

- Foundry VTT v12, v13 or v14
- An OpenAI-compatible API endpoint with **tool/function calling support**

> [!IMPORTANT]
> **Simulacrum requires models that support tool/function calling.** This is how the AI interacts with your Foundry world. Models without tool support will produce errors or fail to respond. See [Choosing a Model](#choosing-a-model) below.

### Choosing a Model

Simulacrum works with any OpenAI-compatible endpoint that supports tool calling. Below are some common options, but any compatible provider will work:

#### Free Tier (~$0)

Perfect for trying Simulacrum or light usage.

| Provider | Setup |
|----------|-------|
| **Google AI Studio** | Base URL: `https://generativelanguage.googleapis.com/v1beta/openai`<br>Get API key: [aistudio.google.com/apikey](https://aistudio.google.com/apikey)<br>Model: `gemini-3-flash-preview` or `gemini-3-pro-preview` |
| **OpenRouter Free** | Base URL: `https://openrouter.ai/api/v1`<br>Get API key: [openrouter.ai/keys](https://openrouter.ai/keys)<br>Model: `openrouter/auto` (auto-selects free models with tool support) |

*Free tiers have rate limits (typically 50-250 requests/day). Sufficient for testing and occasional use.*

#### Pay-Per-Use (~$0.01-0.10 per session)

Best balance of cost, speed, and capability.

| Provider | Setup |
|----------|-------|
| **OpenAI** | Base URL: `https://api.openai.com/v1`<br>Models: `gpt-5-nano` (cheapest), `gpt-5-mini`, `gpt-5.2` |
| **Anthropic** | Requires [OpenRouter](https://openrouter.ai) or compatible proxy<br>Models: `claude-haiku-4.5`, `claude-sonnet-4.5`, `claude-opus-4.5` |
| **OpenRouter** | Access to 100+ models from one API key<br>[Browse models with tool support](https://openrouter.ai/models?supported_parameters=tools) |

#### Local Inference (Hardware Investment)

Run models privately on your own hardware.

| Component | Recommendation |
|-----------|---------------|
| **Software** | [Ollama](https://ollama.com) — see their [model library](https://ollama.com/library) for tool-capable models |
| **Model Size** | 20B+ parameters recommended for complex tasks |
| **GPU VRAM** | 24GB+ for best experience (16GB minimum with quantization) |
| **Hardware Cost** | Used RTX 3090 (~$800-1300) or RTX 4090 (~$2200) |

> [!WARNING]
> **Small models (7B-14B) will struggle** with Simulacrum's multi-tool workflows. Expect slow responses and frequent errors. If your hardware is limited, cloud APIs provide a better experience.

### Verifying Tool Support

Not sure if your model supports tools? Check these resources:
- **OpenRouter**: [Models with tool support](https://openrouter.ai/models?supported_parameters=tools)
- **Ollama**: Model pages indicate "Tools" support in capabilities
- **Provider docs**: Search for "function calling" or "tool use" in your provider's documentation

## Support

- **v12 issues**: [Issues for this fork](https://github.com/Aegis-plus/simulacrum-foundry-v12/issues)
- **Everything else**: [Upstream issues](https://github.com/Daxiongmao87/simulacrum-foundry/issues) and the upstream [Discord](https://discord.gg/VSs8jZBgmP)
- **Source**: [This fork](https://github.com/Aegis-plus/simulacrum-foundry-v12) · [Upstream](https://github.com/Daxiongmao87/simulacrum-foundry)
- **Support the original author**: [Buy Me a Coffee](https://buymeacoffee.com/daxiongmao87)

## License

MIT License - see [LICENSE](LICENSE) for details.

## Credits

Simulacrum was created by [Daxiongmao87](https://github.com/Daxiongmao87).
Foundry VTT v12 compatibility by [Aegis-plus](https://github.com/Aegis-plus).
