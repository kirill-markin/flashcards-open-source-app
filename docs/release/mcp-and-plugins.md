# MCP and Plugins

Read the [release entry point](README.md) for authorization, completion, and
required reading, and the mandatory [shared evidence rules](evidence.md) before
following this procedure.

## Release Inventory

| Channel | Existing destination and release obligation |
| --- | --- |
| Web, backend, machine API/MCP runtime | Verify deployed components, public web access, machine discovery, and applicable smokes under [Web and Backend](web-backend.md#web-and-backend). |
| iOS | Verify the matching version on the public App Store; [iOS procedure](ios.md#ios). |
| Android | Verify the matching production version and rollout on Google Play; [Android procedure](android.md#android). |
| Official MCP Registry | Verify `com.nibomo/flashcards` at the target manifest version; [MCP procedure](mcp-and-plugins.md#mcp). |
| Claude connector and plugin | Verify the [connector](https://claude.ai/directory/nibomo) and the plugin's separate public/installable version; [Anthropic gate](mcp-and-plugins.md#anthropic-connector-and-plugin). |
| Smithery | Verify/update the [existing server](https://smithery.ai/servers/kirill-fofi/nibomo), endpoint, health, auth, and discovered tools. |
| Glama | Verify/update the [existing connector](https://glama.ai/mcp/connectors/com.nibomo/flashcards), endpoint, health, auth, and discovered tools. |
| Gemini CLI | Verify the [gallery entry](https://geminicli.com/extensions/?name=kirill-markinnibomo-plugins) and released install/update source and version. |
| Executor | Verify/update the [existing public app](https://v2.executor.sh/apps/nibomo/nibomo) from reviewed `executor/` source; record uploaded/deployed/published identities separately from Git and installed copies. |
| OpenAI | Reconcile the existing submission's current package, review/publication state, and any required update. Preserve its identity; a disabled website button is not a public listing. |
| Antigravity | Optional marketplace work; packaged assets do not prove listing approval. Include publication only when explicitly scoped. |

Provider-specific update, installation, and workflow verification belong in
[`nibomo-plugins` publishing](https://github.com/kirill-markin/nibomo-plugins/blob/main/docs/publishing.md)
and [Executor publishing](https://github.com/kirill-markin/nibomo-plugins/blob/main/executor/README.md).
The inventory's current MCP listings must resolve to
`https://mcp.nibomo.com/mcp`. Record health, authentication, and discovered
tool inventory against the
[shared contract](../connector-directory-submission.md), including any stale provider
cache or unresolved diagnostic. Run the companion's real OAuth/create/study/edit
verification when affected inputs change or valid evidence is missing. Package
CI alone proves neither OAuth nor those user workflows.

At each release, inspect the website's current `origin/main`
[`Footer.tsx`](https://github.com/kirill-markin/flashcards-open-source-app-website/blob/main/src/components/Footer.tsx)
and [`connectorDirectories.ts`](https://github.com/kirill-markin/flashcards-open-source-app-website/blob/main/src/lib/connectorDirectories.ts).
Reconcile every distribution link with this inventory. Whenever a website link
is added, update this inventory and its procedure in the same change. During
an authorized release, change the website only when verified public status or
URLs require it, using that repository's instructions and checks. Never enable
a directory button based only on a submission or approval.

## MCP

First inspect the public registry for the target `server.json.version` and
compare its manifest with the intended release. Reuse a matching publication
and its workflow evidence. Only if that version is absent, run
`MCP Registry Publish` (`.github/workflows/mcp-registry-publish.yml`) on
`main` while `server.json.version` still names the current release. Check that
the run used the intended manifest/version and completed successfully; the
workflow validates, publishes, and verifies the registry entry. No console
publication step follows. See [publisher details](../mcp-registry-publishing.md)
only for troubleshooting or credential setup.

Completion: the intended version and manifest are verified at the public
registry endpoint and linked to successful workflow evidence. Registry versions
are immutable: do not republish a version or bump just to retry. A conflicting
published manifest blocks this channel and needs an explicit resolution.

## Anthropic Connector and Plugin

Use the existing [Nibomo connector](https://claude.ai/directory/nibomo) and plugin
submission `d8c1028d-4318-4da5-8514-1ed3e0b9a09e` in the
[developer portal](https://claude.ai/directory/manage), in the owning Claude
organization. The plugin source is the root of
[`kirill-markin/nibomo-plugins`](https://github.com/kirill-markin/nibomo-plugins),
tracked on `main`. Update these listings; do not create duplicate submissions.

1. **Connector runtime:** verify the release's backend deployment and MCP smoke
   in `AWS/Web Release` succeeded for the intended commit. The connector and
   plugin both use `https://mcp.nibomo.com/mcp`; backend deployment updates that
   server. Record its deployed release version/commit and MCP verification.
   `initialize.serverInfo.version` currently comes from `SERVER_VERSION = "v1"`
   in `apps/backend/src/mcp/server.ts`, not the package version. Preserve that
   identity during a version bump; it is not proof of the deployed app version.
2. **Connector listing:** inspect the existing public listing and update changed
   metadata, including displayed tool names, through its existing portal entry.
   Submit those edits for review and record their status. Server/tool changes
   deploy normally; they do not require a new connector submission or a guessed
   directory version field. Follow Anthropic's
   [server update instructions](https://claude.com/docs/connectors/building/after-publishing#mcp-server-changes)
   and [listing edit procedure](https://claude.com/docs/connectors/building/managing-your-listing#edit-your-listing).
3. **Plugin source:** verify the [plugin version surfaces](versioning.md#anthropic-plugin-version-sources)
   were aligned to the selected target during [release preparation](versioning.md#release-preparation),
   even when only the product version changed. Follow
   that repository's [packaging and verification instructions](https://github.com/kirill-markin/nibomo-plugins/blob/main/docs/publishing.md)
   and require its **Plugin packages** cloud CI for the exact source commit.
   Record the merged preparation commit and artifact/run link; apply the
   [publication safeguards](versioning.md#release-closeout-and-development) before
   any further merge to tracked `main`. Package validation alone does not verify OAuth or study flows.
4. **Plugin update:** after the aligned manifest version and plugin changes
   reach `kirill-markin/nibomo-plugins` `main`, the connected GitHub push webhook
   notifies Anthropic and triggers validation/security scans automatically.
   Confirm the new version and source commit in the existing submission,
   inspect scan results, and fix blocking findings. **Check for new commits**
   is only needed if delivery/detection failed or to retry after fixes.
   Follow [Update a published plugin](https://claude.com/docs/plugins/submit#update-a-published-plugin)
   and [Publish a passing version](https://claude.com/docs/plugins/submit#publish-a-passing-version).
   Check the applied policy in **Overview → Auto-publish** together with
   **Settings → Publish new versions automatically**. Passing updates publish
   automatically only when Anthropic's applied policy allows it, the toggle is
   on, and no reviewer hold applies. Inspect the actual policy and version status
   on every run: a matching version may already have published automatically.
   Otherwise select **Publish** / **Publish update** as offered and verify
   whether it went live or created a reviewer request; do not assume every
   version requires reviewer approval.
   Reuse an already submitted or published matching version on resume.
5. **Publication evidence:** record plugin version, source commit, CI and scan
   results, publication policy, request/status, and public listing link when
   verified. Check the plugin's own public listing and installable version;
   the connector URL does not establish plugin availability. A scan, Publish
   request, private ZIP upload, or portal **Published** status alone does not
   prove public visibility. Report reviewer delay or public propagation
   separately; the directory serves the last published version meanwhile.

Completion: the runtime, required connector listing edits, and matching plugin's
public/installable version are verified. Apply the [common completion rule](README.md#release-inventory-and-completion)
to reviewer or propagation delays; a request alone leaves this channel open.
