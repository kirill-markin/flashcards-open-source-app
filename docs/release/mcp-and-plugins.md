# MCP and Plugins

Read the [release entry point](README.md) for authorization, completion, and
required reading, and the mandatory [shared evidence rules](evidence.md) before
following this procedure.

## Release Inventory

| Channel | Existing destination and release obligation |
| --- | --- |
| Web, backend, machine API/MCP runtime | Verify deployed components, public web access, machine discovery, and applicable smokes under [Web and Backend](web-backend.md#web-and-backend). |
| iOS | Verify the exact submission and saved release mode, or matching existing publication; [iOS procedure](ios.md#ios). |
| Android | Verify the matching production version and rollout on Google Play; [Android procedure](android.md#android). |
| Official MCP Registry | Verify `com.nibomo/flashcards` at the target manifest version; [MCP procedure](mcp-and-plugins.md#mcp). |
| Claude connector and plugin | Verify runtime and accepted updates to the [connector](https://claude.ai/directory/nibomo) and separate plugin; record each public state under the [Anthropic gate](mcp-and-plugins.md#anthropic-connector-and-plugin). |
| Smithery | Verify/update the [existing server](https://smithery.ai/servers/kirill-fofi/nibomo), endpoint, health, auth, and discovered tools. |
| Glama | Verify/update the [existing connector](https://glama.ai/mcp/connectors/com.nibomo/flashcards), endpoint, health, auth, and discovered tools. |
| Gemini CLI | Verify the [gallery entry](https://geminicli.com/extensions/?name=kirill-markinnibomo-plugins) and released install/update source and version. |
| Executor | Verify/update the [existing public app](https://v2.executor.sh/apps/nibomo/nibomo) through the companion's **Executor Publish** workflow; follow the [Executor procedure](#executor). |
| OpenAI | Initial publication is excluded from routine release until a separately scoped initial launch establishes this channel. Preserve the existing submission identity and procedure in the companion repository; a disabled website button is not a public listing. |
| Antigravity | Optional marketplace work; packaged assets do not prove listing approval. Include publication only when explicitly scoped. |

Provider-specific update, installation, and workflow verification belong in
[`nibomo-plugins` publishing](https://github.com/kirill-markin/nibomo-plugins/blob/main/docs/publishing.md)
and [Executor publishing and access setup](https://github.com/kirill-markin/nibomo-plugins/blob/main/docs/publishing.md#executor).
For established channels, perform concise immediate checks: verify the intended
endpoint, package/source identity, required CI/scans, and acceptance of any
required update/submission. Current MCP listings must resolve to
`https://mcp.nibomo.com/mcp`; compare health, authentication, and discovered
tools with the [shared contract](../connector-directory-submission.md).
Reuse shared runtime smoke evidence and valid unchanged client evidence.
Run focused real OAuth/create/study/edit checks for affected clients when inputs
change or required evidence is missing; do not require an exhaustive every-client
matrix on unchanged inputs. Package CI alone proves neither OAuth nor user flows.

An accepted update/publication request or verified unchanged publication completes
our established-channel action after required gates pass. Record external review,
crawl, stale caches and propagation separately; they do not hold overall closeout
open. An immediate failure, rejected request, failed required scan/test, or
release warning that blocks under the [release warning policy](README.md#release-warning-policy)
must be fixed before that action counts complete.
Preserve exact package/source/request identities and factual pending versus live
status under the [canonical contract](README.md#release-inventory-and-completion).
The registry retains its specific direct-verification gate below.

At each release, inspect the website's current `origin/main`
[`Footer.tsx`](https://github.com/kirill-markin/flashcards-open-source-app-website/blob/main/src/components/Footer.tsx)
and [`connectorDirectories.ts`](https://github.com/kirill-markin/flashcards-open-source-app-website/blob/main/src/lib/connectorDirectories.ts).
Reconcile every distribution link with this inventory. Whenever a website link
is added, update this inventory and its procedure in the same change. During
an authorized release, change the website only when verified public status or
URLs require it, using that repository's instructions and checks. Never enable
a directory button based only on a submission or approval.

## MCP

The companion repository owns [`server.json`](https://github.com/kirill-markin/nibomo-plugins/blob/main/server.json)
and the registry workflows. During [release preparation](versioning.md#release-preparation),
align its manifest and plugin versions with the selected core release version.
Require successful [MCP Registry Validate](https://github.com/kirill-markin/nibomo-plugins/actions/workflows/mcp-registry-validate.yml)
for changed release inputs and **Plugin packages** cloud CI for the intended
companion source.

First inspect the public registry for the target companion `server.json.version`
and compare its manifest with the intended release. Reuse a matching publication
and its workflow evidence. Only if that version is absent, dispatch
[MCP Registry Publish](https://github.com/kirill-markin/nibomo-plugins/actions/workflows/mcp-registry-publish.yml)
on companion `main` while its manifest still names the current release:

```sh
gh workflow run mcp-registry-publish.yml \
  --repo kirill-markin/nibomo-plugins \
  --ref main
```

Check that the run used the intended manifest/version and completed successfully;
the workflow validates, publishes, and verifies the registry entry. No console
publication step follows. See [publisher details](https://github.com/kirill-markin/nibomo-plugins/blob/main/docs/mcp-registry-publishing.md)
only for troubleshooting or credential setup.

Completion: the intended version and manifest are verified at the public
registry endpoint and linked to successful workflow evidence. Registry versions
are immutable: do not republish a version or bump just to retry. A conflicting
published manifest blocks this channel and needs an explicit resolution.

## Executor

Follow the companion's [canonical procedure and credential setup](https://github.com/kirill-markin/nibomo-plugins/blob/main/docs/publishing.md#executor).

1. Complete the companion's required exact-source **Plugin packages** cloud CI,
   including **Executor typecheck**, and applicable focused workflow checks.
   Publishing its prepared stable GitHub Release triggers **Executor Publish**
   (`.github/workflows/executor-publish.yml`, `release.published`). The workflow
   uploads the selected release's exact Git source using the publisher from
   reviewed `main`; development pushes never publish same-version source.
2. Inspect the workflow result. To retry an existing stable release after
   resolving a failure, dispatch **Executor Publish** from `main` with
   `release_tag=vX.Y.Z`, selecting the intended immutable release tag. Follow
   the companion procedure for the command and failure diagnosis; retrying an
   older release intentionally republishes its source.
3. Retain the Actions summary in the [release ledger](evidence.md#release-ledger):
   release/tag and publisher SHAs, exact-source cloud run, Executor source
   commit, deployment ID/commit, accepted publication, and immediate anonymous
   listing/source observation. Keep these identities and outcomes separate.
   After required checks pass, accepted publication or a verified **no update
   needed** result completes operator work. External propagation remains
   follow-up. Existing installed copies do not update automatically; record
   unexecuted installed-copy/runtime checks explicitly.

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
   [publication settings and source safeguards](versioning.md#release-closeout-and-development)
   before any further merge to tracked `main`. Keep Anthropic automatic
   publication and the GitHub push webhook enabled; passing pushes may publish
   under the applied reviewer policy. Package validation alone does not verify OAuth or study flows.
4. **Plugin update:** after the aligned manifest version and plugin changes
   reach `kirill-markin/nibomo-plugins` `main`, the connected GitHub push webhook
   notifies Anthropic and triggers validation/security scans automatically.
   Confirm the new version and source commit in the existing submission,
   inspect scan results, and fix blocking findings. **Check for new commits**
   is only needed if delivery/detection failed or to retry after fixes.
   Follow [Update a published plugin](https://claude.com/docs/plugins/submit#update-a-published-plugin)
   and [Publish a passing version](https://claude.com/docs/plugins/submit#publish-a-passing-version).
   Verify the GitHub push webhook remains enabled and the saved
   **Settings → Publish new versions automatically** setting remains on. Check
   the applied reviewer policy in **Overview → Auto-publish**. Passing updates publish
   automatically only when Anthropic's applied policy allows it, the toggle is
   on, and no reviewer hold applies. Inspect the actual policy and version status
   on every run: a matching version may already have published automatically.
   Otherwise select **Publish** / **Publish update** as offered and verify
   whether it went live or created a reviewer request; do not assume every
   version requires reviewer approval.
   Reuse an already submitted or published matching version on resume.
5. **Publication evidence:** record plugin version, source commit, CI and scan
   results, publication policy, request/status, and public listing link when
   verified. Make an immediate check of the plugin's own public listing and
   installable version; the connector URL does not establish plugin availability.
   A scan, Publish request, private ZIP upload, or portal **Published** status alone does not
   prove public visibility. Report reviewer delay or public propagation
   separately; the directory serves the last published version meanwhile.

Completion: the runtime and focused affected-client checks passed, required
CI/scans passed, and required connector/plugin publication requests for the
exact source/version were accepted (or matching unchanged publications verified).
A scan or private package upload alone is insufficient; complete the available
**Publish** action. Record a resulting reviewer request or propagation delay
as external follow-up under the [common completion rule](README.md#release-inventory-and-completion);
do not wait for public/install propagation or label pending updates live.
