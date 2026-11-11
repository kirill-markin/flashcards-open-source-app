# Publishing Nibomo plugins

Use this guide during an authorized release. The [release runbook](release/README.md)
owns authorization and completion; [versioning](release/versioning.md) owns target
selection and source alignment. Documentation edits do not authorize publication.

The main app repository owns [package tooling](../scripts/plugins/), the
[Executor runtime](../apps/executor/), the [CI checkout action](../.github/actions/checkout-core-source/action.yml),
publisher workflows and operator instructions. The companion
[nibomo-plugins](https://github.com/kirill-markin/nibomo-plugins) owns shared
skills, manifests and the CI workflows that validate the companion checkout.
Release credentials stay outside the source Anthropic scans. Preserve Anthropic's
repository root, tracked main, listing and connector pairing. Complete the
applicable manual reviewer/publication action after the source scan passes.

## Shared source and package formats

The companion root is one plugin with one skills directory. Portable, Claude,
Gemini and registry versions stay aligned with the selected core version.
All formats use https://mcp.nibomo.com/mcp; Antigravity metadata is derived.

| Format | Manifest and MCP configuration |
| --- | --- |
| Claude | .claude-plugin/plugin.json; .mcp.json, type http |
| OpenAI | Generated root plugin.json, Agent Plugins schema 1.0.0; mcp.json, type streamable-http |
| Gemini CLI | gemini-extension.json, including mcpServers.nibomo.httpUrl |
| Antigravity | Generated plugin.json with only name and description; mcp_config.json with mcpServers.nibomo.serverUrl |

[Plugin packages](https://github.com/kirill-markin/nibomo-plugins/actions/workflows/packages.yml)
checks the official Claude CLI, published portable schemas, shared identity/MCP
wiring, source/archive agreement, Antigravity's minimal contract and official
Gemini CLI install/list in a temporary profile. Its nibomo-plugin-packages artifact
contains four ZIPs. Archives contain platform configuration, shared skills,
references, assets, README and license; maintenance scripts and CI dependencies
are excluded. CI proves package structure and Gemini installation, not directory
approval, account connection or real workflows.

## Release source and durable packages

Complete [release preparation](release/versioning.md#release-preparation) and pin
both repositories' SHAs. Development retains the last coordinated version; a
version string alone does not identify source.

The companion's `core-source.json` contains one `commit` field with the full
lowercase SHA of a core `main` commit. Companion CI runs the package and registry
tools and type-checks the Executor app from that pin. Update it through companion
main CI when those inputs change. Historical companion tags retain their original
files and CI evidence.

1. Require successful exact-source companion main-push **Plugin packages**,
   including **packages** and **Executor typecheck**, plus applicable PR checks.
2. Download that run's original nibomo-&lt;version&gt;-claude.zip,
   nibomo-&lt;version&gt;-openai.zip, nibomo-&lt;version&gt;-gemini.zip and
   nibomo-&lt;version&gt;-antigravity.zip. Inspect manifests, skills/references and MCP
   identity. Retain source, run URL and SHA-256 digests in the
   [ledger](release/evidence.md#release-ledger). Antigravity has no manifest version;
   its filename and source mapping identify it.
3. Reuse an exact matching companion tag/[Release](https://github.com/kirill-markin/nibomo-plugins/releases),
   or create an immutable annotated vX.Y.Z tag and stable Release at that SHA.
   Attach all four original CI ZIPs. Conflicting tags, source or digests block
   publication: never move tags or overwrite assets. Establish the
   [Gemini asset channel](#public-listings) before advertising installability.
   The companion Release and exact-source CI must exist **before** publishing
   the coordinated core GitHub Release, which triggers Executor.
4. Record each provider's existing listing/submission identity, source/version,
   accepted request, dated evidence, live/pending state and next action under the
   [completion policy](release/README.md#release-inventory-and-completion).
   Required CI/scans and affected checks still apply; package success alone is
   not provider availability.

Mac-only releases preserve coordinated publications and do not publish other
platforms; use the [Mac tag rules](release/versioning.md#mac-only-source-and-tags).
Never republish immutable versions or bump a version just to test migration.
Registry and provider publication are separate actions.

## Publishing credentials

Core Actions owns MCP_PRIVATE_KEY and EXECUTOR_API_TOKEN. These release secrets
are separate from customer OAuth, DCR and reviewer-account credentials. Preserve
provider identities, customer connections and namespace keys during migration.
Keep secrets out of source, command arguments, logs, ZIPs and release artifacts.

### Migrate publishing secrets

After core publishers land on main, review and run the core
[migration helper](../scripts/plugins/migrate_publishing_secrets.py) with existing
local gh authentication and openssl on PATH:

~~~sh
python3 scripts/plugins/migrate_publishing_secrets.py
~~~

It has fixed companion-source/core-destination repositories and needs no secret
arguments or environment values. Both main branches must contain the active manual
mcp-registry-publish.yml workflow. Temporary branches replace only that workflow
path to export CMS-encrypted secret values using an ephemeral public certificate.
The helper decrypts locally, writes destination secrets through standard input,
exports encrypted destination values and compares them in memory. It cleans its
own temporary branches, artifacts and key files; it never deletes source secrets.

Retain companion secrets and publishers until core is merged and encrypted
readback confirms both destination values match. Secret-name presence is
insufficient. Only then remove companion publishers/operator docs and old
publishing secrets. Do not run old/new publishers simultaneously or dispatch
a release merely to test migration.

### One-time credential setup

For existing credentials, [transfer the originals](#migrate-publishing-secrets);
do not rotate them because ownership moved. For a genuinely missing registry
credential, use the core main checkout's
[setup helper](../scripts/setup/setup-mcp-registry-credential.sh):

~~~sh
bash scripts/setup/setup-mcp-registry-credential.sh \
  --domain nibomo.com \
  --repo kirill-markin/flashcards-open-source-app
~~~

The ignored core root .env must supply CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID
for the **nibomo.com** zone while it runs. Restore their normal
flashcards-open-source-app.com zone values immediately afterwards. Keep .env and
DNS helpers in core. The helper creates an Ed25519 keypair and root public-key TXT
record, stores MCP_PRIVATE_KEY in the explicit destination and deletes its
temporary key file. It is idempotent when both secret and record exist, and fails
rather than rotating if only one exists. For a missing record, check zone/domain
selection and deletion; never delete an existing secret to bypass the error.

For Executor, create a dedicated personal token scoped only to **Nibomo** in
[Account settings → Tokens](https://v2.executor.sh/account/tokens), following
[the token instructions](https://v2.executor.sh/docs/api-keys). Its user needs
owner/admin access and edit/publish permission for the existing app. Retain the
one-time value in the secret manager, choose an expiry, and use the hidden prompt:

~~~sh
gh secret set EXECUTOR_API_TOKEN --repo kirill-markin/flashcards-open-source-app
~~~

Rotate/revoke that dedicated token in Account settings and update core's secret.
Missing publisher secrets fail before provider access.

## MCP Registry

The companion owns [server.json](https://github.com/kirill-markin/nibomo-plugins/blob/main/server.json).
Core owns [schema validation](../scripts/plugins/validate_mcp_registry.py) and
manual [MCP Registry Publish](../.github/workflows/mcp-registry-publish.yml).
The manifest's repository.url points to core, where the backend lives. The entry
is com.nibomo/flashcards, a hosted streamable-http remote at
https://mcp.nibomo.com/mcp; the [tool contract](connector-directory-submission.md)
is maintained separately. DNS verification checks the namespace name, not the URL.

### Validate the manifest

Require companion [MCP Registry Validate](https://github.com/kirill-markin/nibomo-plugins/actions/workflows/mcp-registry-validate.yml)
for changed release inputs and **Plugin packages** for exact-source version alignment.
Validation needs no namespace key and never publishes.

### Publish flow

Follow the [MCP gate](release/mcp-and-plugins.md#mcp). Inspect the exact public
version and reuse matching publication. For an authorized, unpublished version,
dispatch core main with the existing companion release tag:

~~~sh
gh workflow run mcp-registry-publish.yml \
  --repo kirill-markin/flashcards-open-source-app \
  --ref main -f release_tag=vX.Y.Z
~~~

The workflow checks out the selected companion release and validates its exact
manifest with core's validator and requirements. It reuses an existing
exact version as a successful no-op when its manifest matches. A conflicting
immutable manifest fails. For an unpublished version, it authenticates with core's
MCP_PRIVATE_KEY, publishes and verifies the exact registry endpoint.
Check source/version and successful run evidence;
there is no console publication step. Registry versions cannot be overwritten.
A metadata refresh needs a user-selected new coordinated version under
[release preparation](release/versioning.md#release-preparation). Do not bootstrap
credentials or repeat local validation for every release.

For diagnosis of an authorized publish outside Actions, use official mcp-publisher
from an isolated checkout of that same companion release. Confirm cloud validation
and absence of the exact version first. Supply a securely retained namespace key
as MCP_PRIVATE_KEY (Actions secrets cannot be read back as plaintext), then run:

~~~sh
mcp-publisher login dns --domain nibomo.com --private-key "$MCP_PRIVATE_KEY"
mcp-publisher publish
~~~

The CLI reads server.json from the current directory.

### Previous namespace

The separate com.flashcards-open-source-app/flashcards record retains its version
history and legacy MCP address; legacy hosts serve the same backend/routes.
Changing the name creates a separate record. Even a deprecated record retains its
remote URL, so its address cannot be reused by the new entry.

An authorized deprecation needs its own flashcards-open-source-app.com Ed25519 key
and Cloudflare zone (the core .env's normal zone), with a message pointing to
com.nibomo/flashcards. Current MCP_PRIVATE_KEY belongs to nibomo.com. If the old key
is unavailable, generate one securely and replace the old domain's single
v=MCPv1; k=ed25519; p=... root TXT record; never add a second matching record.
Do not use the setup helper to rotate it: it rejects existing-key conflicts.
Authenticate the CLI with the old domain/key to deprecate that record.

## Anthropic

Use submission d8c1028d-4318-4da5-8514-1ed3e0b9a09e in the owning organization's
[developer portal](https://claude.ai/directory/manage). Preserve
kirill-markin/nibomo-plugins, root path, tracked main, connector pairing,
**Publish new versions automatically** and the GitHub push webhook.

Compare target SHA/version with **Versions** and validation/security results after
each source change. The webhook handles detection; **Check for new commits** is for
detection failure/retry. Require applicable scans and [workflow checks](#real-workflow-verification).
Inspect saved settings, **Overview → Auto-publish** reviewer policy and actual
version status: a clean scan does not establish automatic approval or an accepted
publication request. Complete the offered **Publish** / **Publish update** or
reviewer request when required. If disabled, follow the
[reviewer-held action procedure](release/mcp-and-plugins.md#reviewer-disabled-plugin-publication);
preserve accepted pending requests and exact source, without bypassing the hold
through ref/settings changes. Never create another plugin or MCP submission.

Record request acceptance, reviewer state and public availability separately.
When available, check the plugin's own listing and fresh directory installation
for selected version/skills. The connector listing or private import is not public
plugin evidence. Follow [Anthropic's publication procedure](https://claude.com/docs/plugins/submit)
for live controls and confirm changed declarations and exact acknowledgments:

| Data question | Prepared answer |
| --- | --- |
| Personal data | Reads and stores |
| Skills send data outside declared connectors | No |
| Retention | Longer |
| Intended for users under 18 | Yes, subject to Nibomo's minimum-age and parental-permission rules |
| Contact | kirill@kirill-markin.com |

The [privacy policy](https://nibomo.com/privacy/) and [terms](https://nibomo.com/terms/)
govern the hosted service.

## OpenAI

Update existing plugin asdk_app_6ab77a6e971c81918b9e9185a6a19d58 and its
[public listing](https://chatgpt.com/plugins/plugin_asdk_app_6ab77a6e971c81918b9e9185a6a19d58).
Sign in to [Plugins](https://platform.openai.com/plugins) as kirill@kirill-markin.com,
using the existing organization/project and verified **SAMO DANNI EOOD** identity.
Owners can submit; other members need **Apps Management Write**. This login is
separate from the Nibomo reviewer account.

The archive inherits portable plugin.json, overriding only its package name from
companion openai-package.json to app-6ab77a6e971c81918b9e9185a6a19d58; source
identities stay nibomo. Omit mcpAuth to reuse the existing connection and
byte-identical portable mcp.json. For an explicitly authorized new connection,
optional mcpAuth adds only mcpServers.nibomo.extensions["com.openai"].auth for
OAuth/DCR; discovery supplies endpoints. CI validates the portable schema projection
and exact vendor extension separately because the portable schema rejects that
OpenAI extension. Keep copy within [submission limits](https://developers.openai.com/plugins/deploy/submission#manifest-fields).

1. Inspect published package, draft and **Review status**. Only one review can
   be active; preserve accepted pending source and record the next action.
   Cancellation needs explicit direction. For a legacy MCP-only package, use
   **… → Download release ZIP** and inspect actual skills/installed copy; an MCP
   listing does not establish bundled skills.
2. For hosted MCP changes, deploy the existing endpoint. OpenAI scans daily;
   eligible tool updates go live after checks without a package publish. Inspect
   **MCPs → connected server → Issues → Rescan**, **Held update** and **Live
   definition** where offered, plus tool availability. Preserve approved-schema
   compatibility while held. Compatible result changes need no ZIP; a changed
   MCP URL requires support.
3. For metadata, assets, skills or a coordinated package version, use the complete
   [exact-source durable ZIP](#release-source-and-durable-packages). With no active
   review, select **Upload plugin to make changes** on the same plugin. Inspect
   **Metadata & Skills**, resolve findings and require safety/security scans.
   Keep managed fields in source under extensions.com.openai; use the
   [metadata mapping](openai-plugin-metadata.md) and [official import reference](https://developers.openai.com/plugins/deploy/submission#automatically-provide-submission-and-review-information).
4. Verify setup/domain checks and [affected workflows](#real-workflow-verification).
   **Review information → Review details** needs five positive and three negative
   cases, a reviewer-accessible recording and release notes. Use a dedicated test
   account/sample data with required permissions and immediate sign-in, without
   MFA approval, codes, magic links or private-network access. Save private access
   details only there and keep the account available for later reviews.
5. **Submit for review**, complete attestations and record acceptance. After
   approval, select **Publish plugin** on that version. Record review, approval,
   publication and public installation independently. When available, verify a
   fresh ChatGPT/Codex install exposes actual version, skills and live tools;
   a private import is insufficient.

Keep existing OAuth discovery/DCR. OpenAI rejects ZIP auth overrides for an
already configured connection; edit secure portal settings only when authorized.
The connection panel may not replace locked client registration. DCR needs no
packaged credentials; a supplied client's secret belongs only in the secure form,
never source or ZIP headers.

For a reviewed identity/connection-metadata repair after immutable coordinated
publication, keep shared versions unchanged and require exact-source main CI.
Create an annotated openai-vX.Y.Z-identity-migration,
openai-vX.Y.Z-connection-metadata or openai-vX.Y.Z-existing-connection tag and stable
supplemental companion Release with make_latest=false. Attach only that run's
original OpenAI ZIP. Preserve coordinated assets, Executor remediation source and
Gemini Latest; upload to the same plugin, never hand-edit an archive. OpenAI-only
Releases do not trigger Executor.

## Executor

Core's [Executor Publish](../.github/workflows/executor-publish.yml) runs for a
published stable coordinated core vX.Y.Z Release. Publish the matching companion
Release and pass exact-source main **Plugin packages**, including **Executor
typecheck**, **before** the core Release. The publisher resolves Executor source
from the immutable companion tag. A tag with `core-source.json` selects
`apps/executor/` at the pinned core commit on `main`. A tag without the marker
selects `executor/` at the companion tag. Development pushes, OpenAI-only
companion Releases and macos-v... core Releases do not publish Executor.

For failed/skipped runs or a companion remediation Release, dispatch core main
with the intended immutable companion tag:

~~~sh
gh workflow run executor-publish.yml \
  --repo kirill-markin/flashcards-open-source-app \
  --ref main -f release_tag=executor-vX.Y.Z-scope-migration
gh run list --repo kirill-markin/flashcards-open-source-app --workflow executor-publish.yml --limit 5
gh run watch <run-id> --repo kirill-markin/flashcards-open-source-app --exit-status
~~~

Manual dispatch also accepts vX.Y.Z; an older tag intentionally republishes that
source. Keep coordinated tags/assets immutable, including v1.29.0 at
41cd84f6f8b947131dbbca36b6f8a577db1f1993. For a scope repair, merge the corrected
runtime and update the companion pin with versions unchanged. Pass exact-source
CI and create an annotated executor-vX.Y.Z-scope-migration tag plus stable
supplemental companion Release with make_latest=false. Preserve Gemini
Latest/coordinated assets. Remediation publication uses manual core dispatch.

Preserve organization nibomo, scope nibomo.executor.community, existing app
app_741c52b8-681c-4e8c-8536-9b278e02d671, public
[@nibomo.executor.community/nibomo](https://executor.sh/apps/nibomo.executor.community/nibomo)
and account selections. The [package-name contract](https://executor.sh/docs/author-an-app)
has no legacy-scope alias; registry reads use the current scope even if retained
source has the old package name.

The [core publisher](../scripts/plugins/publish_executor.py) reads Git objects for
the five Executor files LICENSE, README.md, index.ts, package.json and
provider.ts. Credentials, dependencies and scratch files stay excluded; unexpected
paths stop publication. Review SOURCE_PATHS with any upload-set change. Before
writes it reads private/deployed/public source, ownership, permissions, app-level
/accounts/app and the publisher's /accounts/user links. It compares ordered account
IDs after deployment; other users' links, labels, health and sign-in state are
outside this check. Before replacing remote source, the working, deployed and
public revisions must agree. The deployed files must match a complete reviewed
main snapshot in core or the companion, including when crossing between layouts.

The [management API](https://github.com/UsefulSoftwareCo/executor/blob/v2/packages/app-management/src/contracts/api.ts)
saves complete files with the observed working commit as expected, deploys the
returned immutable commit, reads back deployment/accounts and publishes that same
commit. Stale revisions, mismatches and transport failures stop the run: inspect
the recorded stage and remote state before retrying. The publisher never creates
apps or changes account selections. Use the [deployment model](https://v2.executor.sh/docs/concepts/apps-and-deployments)
for diagnosis. Publication is serialized without cancelling an active run; a newer
queued run may replace an older pending run, requiring manual dispatch later.

Retain the companion release SHA, core publisher SHA, selected Executor Git
source SHA and path, exact-source CI, Executor source commit, deployment
ID/commit, accepted publication and immediate anonymous listing/source
observation in the ledger. Matching working/deployed/public source yields **no
update needed**. Accepted publication after required checks completes operator
work; propagation remains pending if needed. Installed copies require separate
user review/update; record unexecuted runtime checks. Consumer installation and
connection stay in the [Executor README](../apps/executor/README.md).

## Google

Use companion [consumer installation instructions](https://github.com/kirill-markin/nibomo-plugins/blob/main/README.md#get-started)
for Gemini and Antigravity. Both ZIPs carry shared skills/references/assets; Gemini
discovers OAuth automatically and Antigravity supports OAuth/DCR. Neither embeds
credentials. Antigravity's minimal manifest rejects extra properties.
Record installation, OAuth and workflow evidence separately from package CI.

### Public listings

Retain the existing [Gemini gallery entry](https://geminicli.com/extensions/?name=kirill-markinnibomo-plugins)
and gemini-cli-extension topic. Gallery crawling is separate from installability.
Follow the [release guide](https://geminicli.com/docs/extensions/releasing/).
For type github-release, unpinned installation follows GitHub Latest; a
--ref=&lt;verified-release-tag&gt; installation stays on that tag. Git installations
follow their selected ref or HEAD; local installations compare their source
manifest version. Before development advances companion main:

1. Attach byte-identical Gemini CI ZIP copies as darwin.nibomo.zip,
   linux.nibomo.zip and win32.nibomo.zip to the immutable coordinated Release.
   Verify digests and root gemini-extension.json; platform asset names avoid
   ambiguity among the four formats.
2. Verify Latest points to that Release. Test unpinned and pinned README commands
   in separate clean profiles. Inspect selected asset/payload and
   ~/.gemini/extensions/nibomo/.gemini-extension-install.json under each profile:
   require type github-release, repository source, expected releaseTag, and no
   ref for Latest or the exact tag for the pinned channel.
3. Run gemini extensions update nibomo, checking destination and resulting
   metadata/payload. Already-current is not evidence of a future-version upgrade.
   Explicitly migrate Git/local or unwanted pinned installs: preserve settings/
   customizations, uninstall, reinstall using the stable command, and repeat
   metadata checks. A Release/update does not prove migration; diagnose any
   unexpected Git/local resolution.
4. Record focused OAuth/workflows separately and advertise only verified stable
   commands. A later gallery recheck is follow-up, not a closeout gate.

Antigravity marketplace expansion is optional scope. If requested, preserve the
existing identity and use the [interest form](https://forms.gle/2EX5RFYPoJe1UgxR9)
from [Marketplace documentation](https://antigravity.google/docs/marketplace?tab=cli).
An interest form or installable archive does not establish public approval.

## Real workflow verification

Choose affected checks from changed auth, tools, skills, runtime/provider inputs
and diagnosed failures. Use a synthetic workspace on the authenticated client.
Reuse passing evidence only when relevant inputs are unchanged, recording source/
version, client, account connection and applicability under [shared evidence rules](release/evidence.md).
An exhaustive matrix is unnecessary. If applicable evidence is missing, run the
affected flow before publication. Discovery/guide calls do not prove user flows.

1. Create two tagged cards about WHERE and HAVING from notes. Check duplicate
   inspection, question-only fronts, answer-first backs, tags, saved IDs/readback
   and duplicate handling on a repeated request.
2. Study one test card with an IANA timezone. Check attempt before reveal, feedback,
   announced rating, one acknowledged review and resulting schedule. Use the
   bundled same-payload retry procedure for uncertain outcomes.
3. Audit without writes, then explicitly request a scoped edit and verify saved
   text and tag-filter behavior. Include media preservation when affected.
4. For affected behavior/failures, check skips, ambiguity, audit-only cleanup,
   media or disconnected sessions: clarify/stop without invented grades,
   unauthorized edits or unacknowledged success. These regressions are optional
   when unrelated.

Record public installation when available and pending review/propagation otherwise.
Keep required Gemini asset/install/update checks separate from workflow reuse.
Never describe unexecuted flows or pending publication as passed/live. Apply
[closeout safeguards](release/versioning.md#release-closeout-and-development)
without a development version bump.
