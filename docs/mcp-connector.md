# MCP client setup

Connect to Nibomo at `https://mcp.nibomo.com/mcp`. Follow the [MCP connector guide](https://nibomo.com/docs/mcp-connector/) for client setup and authentication.

Protocol and tool details live in [agent tool surfaces](agent-tool-surfaces.md), [conversational reviews](conversational-reviews.md), and [MCP registry publishing](mcp-registry-publishing.md). Domain compatibility is documented in [backend and web deployment](backend-web-deployment.md).

## Cline CLI

Create an agent API key using the [MCP connector authentication instructions](https://nibomo.com/docs/mcp-connector/#authentication). Add the following `nibomo` entry to `mcpServers` in Cline's MCP settings, preserving any existing servers and replacing `<YOUR_AGENT_KEY>` with your key:

```json
{
  "mcpServers": {
    "nibomo": {
      "type": "streamableHttp",
      "url": "https://mcp.nibomo.com/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_AGENT_KEY>"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

Cline CLI 3.0.68 reads `~/.cline/data/settings/cline_mcp_settings.json` by default. If `CLINE_DATA_DIR` is set, use `$CLINE_DATA_DIR/settings/cline_mcp_settings.json`. For an isolated profile, set `CLINE_MCP_SETTINGS_PATH` to the full path of your MCP settings file when launching Cline; this overrides the default path.

After saving, restart Cline CLI before using the tools so the new session loads the server registration. Ask: "Use Nibomo's `list_workspaces` tool to list my workspaces without changing any data." Approve that read-only call when prompted.
