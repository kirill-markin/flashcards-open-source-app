# Nibomo for Executor

This standalone Executor app connects to the existing Nibomo MCP service at https://mcp.nibomo.com/mcp. It requires your own Nibomo account and OAuth authorization. No product credentials are included in the source.

## Install and connect

Install a reviewed copy from the existing [public Nibomo listing](https://executor.sh/apps/nibomo.executor.community/nibomo), then connect and select your own Nibomo account in the app account settings. An installed copy is separate from its public registry listing; publishing an update does not update existing copies.

Empty account selections expose no upstream tools. Each selected account discovers its own tools and can read and write cards, tags, saved decks, and review progress in workspaces that account can access. Tools marked destructive by the MCP server require approval. Other writes follow the upstream tool policies. Authorize only your own account and review requested changes before approving them.

The app uses Executor's native OAuth discovery, credential handling, per-account catalog cache, and cancellation support. Credentials are restricted to `mcp.nibomo.com`. Exhaustive client runtime testing, including connected-account tool calls, has not been performed.

## Update the published app

See [Executor publication](https://github.com/kirill-markin/flashcards-open-source-app/blob/main/docs/plugin-publishing.md#executor) for the core-owned publishing workflow and operator procedures. The [app release runbook](https://github.com/kirill-markin/flashcards-open-source-app/blob/main/docs/release/README.md) owns authorization and release sequencing. Executor framework and MCP SDK dependency versions are not a Nibomo release version.

## Links

- [Nibomo website](https://nibomo.com)
- [Hosted MCP endpoint](https://mcp.nibomo.com/mcp)
- [Connector documentation](https://nibomo.com/docs/mcp-connector/)
- [Privacy policy](https://nibomo.com/privacy/)
- [Reviewed app source](https://github.com/kirill-markin/flashcards-open-source-app/tree/main/apps/executor)
