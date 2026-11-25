# MCP and Plugins

Read the [release entry point](README.md) for authorization, completion, and
required reading, and the mandatory [shared evidence rules](evidence.md) before
following this procedure.

## Release Inventory

| Channel | Existing destination and release obligation |
| --- | --- |
| Web, backend, machine API/MCP runtime | Verify deployed components, public web access, machine discovery, and applicable smokes under [Web and Backend](web-backend.md#web-and-backend). |
| iOS | Verify the exact submission and saved release mode, or matching existing publication; [iOS procedure](ios.md#ios). |
| macOS | Verify the separate `MAC_OS` build, exact submission and saved release mode, or matching existing Mac publication; [macOS procedure](macos.md). |
| Android phone | Verify the exact version code and rollout on Google Play `production`; [Android procedure](android.md). |
| Wear OS | Verify the exact version code and rollout on `wear:production`; [Wear submission checks](android.md#wear-os-submission). |
| Official MCP Registry | Verify the existing or updated `com.nibomo/flashcards` entry under the [MCP procedure](mcp-and-plugins.md#mcp). |
| Claude connector and plugin | Verify runtime and accepted updates to the [connector](https://claude.ai/directory/nibomo) and separate plugin; record each public state under the [Anthropic gate](mcp-and-plugins.md#anthropic-connector-and-plugin). |
| Glama | Verify/update the [existing connector](https://glama.ai/mcp/connectors/com.nibomo/flashcards), endpoint, health, auth, and discovered tools. |
| Cursor Directory | Verify/update the [existing Nibomo plugin](https://cursor.directory/plugins/nibomo), source, MCP configuration, and shared skills under the [Cursor Directory procedure](#cursor-directory). |
| Gemini CLI | Verify the [gallery entry](https://geminicli.com/extensions/?name=kirill-markinnibomo-plugins) and the [released install/update payload and GitHub Latest](../plugin-publishing.md#public-listings). |
| Executor | Verify/update the [existing public app](https://executor.sh/apps/nibomo.executor.community/nibomo) through core's **Executor Publish** workflow; follow the [Executor procedure](#executor). |
| OpenAI | Verify/update existing plugin `asdk_app_6ab77a6e971c81918b9e9185a6a19d58` and its [public listing](https://chatgpt.com/plugins/plugin_asdk_app_6ab77a6e971c81918b9e9185a6a19d58); inspect hosted MCP scans/live tools and submitted/published package version/skills separately under the [OpenAI gate](#openai). |
| Antigravity | Optional marketplace work; packaged assets do not prove listing approval. Include publication only when explicitly scoped. |

Provider-specific update, installation, and workflow verification belong in
[plugin publishing](../plugin-publishing.md), including
[Executor publishing and access setup](../plugin-publishing.md#executor).
For established channels, verify public listing metadata, endpoint, package
or source identity, required CI/scans, and acceptance of required updates.
Current MCP listings must resolve to `https://mcp.nibomo.com/mcp`. Compare
health, authentication, and discovered tools with the
[shared contract](../connector-directory-submission.md).
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

The companion repository owns [`server.json`](https://github.com/kirill-markin/nibomo-plugins/blob/main/server.json).
Core owns the validator and credential-reading publisher. During
[release preparation](versioning.md#mcp-and-plugin-release-decisions),
compare the intended manifest with the last published registry manifest,
ignoring only the top-level `version` field. If the content matches, record the
existing version and end the registry flow.
Require successful [MCP Registry Validate](https://github.com/kirill-markin/nibomo-plugins/actions/workflows/mcp-registry-validate.yml)
for changed release inputs and **Plugin packages** cloud CI for the intended
companion source.

For changed metadata, inspect the public registry for the target companion
`server.json.version`. Reuse the publication and its workflow evidence if the
full manifest matches, including `version`. If that version is absent, dispatch
[MCP Registry Publish](https://github.com/kirill-markin/flashcards-open-source-app/actions/workflows/mcp-registry-publish.yml)
on core `main` with the intended immutable companion release tag:

```sh
gh workflow run mcp-registry-publish.yml \
  --repo kirill-markin/flashcards-open-source-app \
  --ref main -f release_tag=vX.Y.Z
```

Check that the run used the selected companion release's exact manifest/version
and completed successfully; the core workflow validates, publishes, and verifies
the entry. No console publication step follows. See [publisher details](../plugin-publishing.md#mcp-registry)
for troubleshooting or credential setup.

Completion: the intended version and manifest are verified at the public
registry endpoint and linked to successful workflow evidence. Registry versions
are immutable: do not republish a version or bump just to retry. A conflicting
published manifest blocks this channel and needs an explicit resolution.

## Cursor Directory

Use the existing [Nibomo plugin listing](https://cursor.directory/plugins/nibomo).

1. Compare its public source link with
   [`kirill-markin/nibomo-plugins`](https://github.com/kirill-markin/nibomo-plugins)
   and the intended companion source. Verify the displayed MCP configuration
   uses `https://mcp.nibomo.com/mcp`, the Nibomo account/OAuth instructions,
   and the three shared create, study, and improve skills.
2. Update the existing listing when its source, configuration, skills, or
   metadata changes. Reuse valid unchanged shared runtime and client evidence
   under the [inventory verification policy](#release-inventory); run only
   affected checks before requesting an update.
3. Record the listing URL, observed source/configuration/skills, applicable
   gate evidence, and any accepted update request in the
   [release ledger](evidence.md#release-ledger). Verified unchanged content or
   an accepted required update completes the operator action under the
   [common completion rule](README.md#release-inventory-and-completion).
   Record external review or propagation separately from observed public state.

## Executor

Follow the [canonical procedure and credential setup](../plugin-publishing.md#executor).

1. Record the [resolved Executor source](../plugin-publishing.md#executor) and
   compare its files with the existing publication. Before publishing a stable
   core `vX.Y.Z` Release with a matching companion tag, verify the tag selects the
   intended Executor files. For unchanged Executor, verify the publisher will
   find the same working, deployed and public revision and files.
   Require exact-source **Plugin packages** CI, including **Executor typecheck**,
   for any tag used by the publisher, plus applicable focused workflow checks.
   Publish a new matching companion Release before the core Release that triggers
   **Executor Publish**. Without a matching tag the workflow skips publication.
2. Inspect the workflow result. For a retry or independent Executor
   publication, follow the canonical procedure to dispatch **Executor Publish**
   from core `main` with the intended immutable companion `release_tag`.
   Retrying an older release intentionally republishes its source.
3. Retain the Actions summary in the [release ledger](evidence.md#release-ledger):
   companion release, core publisher and selected Executor Git source SHAs,
   exact-source cloud run, Executor source commit, deployment ID/commit,
   accepted publication, and immediate anonymous listing/source observation.
   Keep these identities and outcomes separate.
   After required checks pass, accepted publication or a verified **no update
   needed** result completes operator work. External propagation remains
   follow-up. Existing installed copies do not update automatically; record
   unexecuted installed-copy/runtime checks explicitly.

## OpenAI

Use the [canonical OpenAI procedure](../plugin-publishing.md#openai)
for the existing plugin, publisher `kirill@kirill-markin.com`, verified
**SAMO DANNI EOOD** identity and owning organization/project. Preserve that
identity and any accepted pending review; no new listing or transfer is needed.
The publisher login is separate from the private Nibomo reviewer test account.

Record the hosted MCP and package decisions separately in the
[ledger](evidence.md#release-ledger), with the applicable **no update needed**,
**submitted**, **live**, **pending**, or **blocked** outcome.

- **Hosted MCP:** verify the intended backend deployment SHA and runtime at
  `https://mcp.nibomo.com/mcp` under [Web and Backend](web-backend.md#web-and-backend).
  Inspect OpenAI's scan findings, held updates, live definitions and actual tool
  availability independently. Eligible hosted tool changes become available
  after automated scans; they do not require a new package or publish action.
  Preserve compatibility with approved schemas while updates are held.
  `initialize.serverInfo.version` is the server identity, not the package version
  or evidence of the deployed app SHA.
- **Package:** apply the [release decision](versioning.md#mcp-and-plugin-release-decisions)
  to the last submitted OpenAI package. For a changed package, use the complete
  exact-source OpenAI CI ZIP from the companion's
  [durable package procedure](../plugin-publishing.md#release-source-and-durable-packages),
  with successful `packages` and **Executor typecheck** for that SHA; retain its
  version, run and digest. Inspect selected draft, required metadata/skill scans,
  review materials and accepted submission/publication requests under the
  canonical procedure. Changed package metadata, assets and skills use ZIP
  review/publication; merge or backend deploy alone does not
  publish them. The public legacy `1.29.0` MCP listing does not establish the
  companion's current `1.33.0` package or three bundled skills. Reconcile its
  downloaded release ZIP and actual installed copy against maintained source;
  use the [metadata mapping](../openai-plugin-metadata.md).

Completion follows the [common boundary](README.md#release-inventory-and-completion):
required CI/scans and applicable focused checks pass, and the exact required
update/submission/publication request is accepted or matching live content is
verified. A ZIP upload or scan alone is insufficient. Record package review,
approval, accepted publication and public installation separately from MCP scan
and live-tool state. External review or propagation remains pending follow-up;
a provider-held unavailable operator action remains pending at its boundary.
Preserve immutable release assets and accepted pending source during
[closeout](versioning.md#release-closeout-and-development), and record each next
action without describing pending packages or skills as live.

## Anthropic Connector and Plugin

Use the existing [Nibomo connector](https://claude.ai/directory/nibomo) and plugin
submission `d8c1028d-4318-4da5-8514-1ed3e0b9a09e` in the
[developer portal](https://claude.ai/directory/manage), in the owning Claude
organization. The plugin source is the root of
[`kirill-markin/nibomo-plugins`](https://github.com/kirill-markin/nibomo-plugins),
tracked on `main`. Update these listings; do not create duplicate submissions.

1. **Connector runtime:** verify the intended deployment and smoke under
   [Web and Backend](web-backend.md). Reuse matching evidence for an unchanged
   deployment. Record the deployed version/commit and MCP verification.
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
3. **Plugin source:** apply the [release decision](versioning.md#mcp-and-plugin-release-decisions)
   to the last requested or published Claude plugin. For a changed payload, follow
   the [packaging and verification instructions](../plugin-publishing.md)
   and require its **Plugin packages** cloud CI for the exact source commit.
   Record the merged preparation commit and artifact/run link; apply the
   [publication settings and source safeguards](versioning.md#release-closeout-and-development)
   before any further merge to tracked `main`. Package validation alone does
   not verify OAuth or study flows.
4. **Plugin update:** when the Claude changes for the selected companion release
   reach `kirill-markin/nibomo-plugins` `main`, the connected GitHub push webhook
   notifies Anthropic and triggers validation/security scans automatically.
   Confirm the new version and source commit in the existing submission,
   inspect scan results, and fix blocking findings. **Check for new commits**
   is only needed if delivery/detection failed or to retry after fixes.
   Follow [Update a published plugin](https://claude.com/docs/plugins/submit#update-a-published-plugin)
   and [Publish a passing version](https://claude.com/docs/plugins/submit#publish-a-passing-version).
   For the changed, passing version, select **Publish** / **Publish update** and verify
   whether it went live or created a reviewer request; do not assume every
   version requires reviewer approval. If reviewer policy disables the action,
   follow [Reviewer-Disabled Plugin Publication](#reviewer-disabled-plugin-publication).
   Reuse an already submitted or published matching version on resume.
5. **Publication evidence:** record plugin version, source commit, CI and scan
   results, publication policy, request/status, and public listing link when
   verified. Make an immediate check of the plugin's own public listing and
   installable version; the connector URL does not establish plugin availability.
   A scan, Publish request, private ZIP upload, or portal **Published** status alone does not
   prove public visibility. Report reviewer delay or public propagation
   separately; the directory serves the last published version meanwhile.

Completion: the applicable runtime, focused client checks and required
CI/scans passed. For each selected listing, record acceptance for the exact
source/version or verify its matching publication.
A scan or private package upload alone is insufficient; complete the available
**Publish** action. Record a resulting reviewer request or propagation delay
as external follow-up under the [common completion rule](README.md#release-inventory-and-completion);
do not wait for public/install propagation or label pending updates live.
For a disabled action, preserve the distinct pending outcome below; it does not
meet the accepted-request boundary.

### Reviewer-Disabled Plugin Publication

When the exact target version/source SHA is detected and its required CI,
scans and focused checks pass, but reviewer policy disables **Publish update**,
record **provider-held operator action pending**, the disabled control and
policy/reason, observation time, Anthropic as hold owner and the operator's
conditional **Publish update** action in the [ledger](evidence.md#release-ledger).
Scan approval is not an accepted publication request or automatic publication.
Record the target version/SHA separately from every accepted pending request's
ID, version/SHA and acceptance time; an older request never counts as acceptance
of the newer source, even when its manifest version matches.

Preserve the existing pending request and tracked ref. Do not poll, rebuild,
resubmit or change the ref/settings to bypass the hold. The next condition is
Anthropic releasing the hold to enable the action or publishing the exact target.
On resume, inspect current state first: reuse a matching accepted request or
publication; if the action becomes available, complete it and verify acceptance.
Continue available required work and hand off the held action under the
[canonical completion rule](README.md#release-inventory-and-completion).
Keep scan result, request acceptance, automatic publication and the actual
public/installable version as separate observations.
