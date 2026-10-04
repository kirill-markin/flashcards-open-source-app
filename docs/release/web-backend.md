# Web and Backend

Read the [release entry point](README.md) for authorization, completion, and
required reading, and the mandatory [shared evidence rules](evidence.md) before
following this procedure.

`AWS/Web Release` deploys from `main` automatically when relevant files change,
limited to the components that changed since their last release.
Verify the release commit's applicable deployment and smoke jobs succeeded. Fix failures before declaring this platform complete;
AWS deploys and their artifacts stay in CI/CD.

Verify public web access and the machine discovery entrypoint
`https://api.flashcards-open-source-app.com/v1/`, with deployed MCP evidence for
`https://mcp.nibomo.com/mcp`. Record component SHAs and the relevant successful
deployment/smoke runs; use the canonical source comparison rules for unchanged
components. The web smoke serves CI-built assets against production APIs, so it
does not by itself prove hosted web availability.

Completion: applicable automatic release/checks are green and the intended
public web/backend/machine runtime is verified. See [Release Gates](../release-gates.md)
for component selection, smoke limits, and migration/rollback rules.
