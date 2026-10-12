# OpenAI directory metadata

The maintained package source is companion
[`plugin.json`](https://github.com/kirill-markin/nibomo-plugins/blob/main/plugin.json)
for identity/version and `extensions.com.openai` metadata, with
[`mcp.json`](https://github.com/kirill-markin/nibomo-plugins/blob/main/mcp.json)
for the shared remote MCP and its authentication declaration. Use the complete
`nibomo-<version>-openai.zip` from successful exact-source companion CI, including
all intended skills, references and assets. The
[canonical OpenAI procedure](https://github.com/kirill-markin/nibomo-plugins/blob/main/docs/publishing.md#openai)
owns upload, scans, review, publication and legacy **Download release ZIP**
reconciliation for the existing plugin; this guide owns reference-copy mapping.

[chatgpt-app-submission.json](chatgpt-app-submission.json) and
[openai-plugin-metadata.json](openai-plugin-metadata.json) are legacy preparation
and reference copy. They are not current package upload formats or authoritative
sources for the package version, MCP settings or published availability. Resolve
their references against maintained companion source rather than uploading
these JSON files or copying their legacy `server.json` pointers into a ZIP.
Existing reference release notes do not establish the current release's changes.

## Map reference copy to maintained source

Follow OpenAI's [package field reference](https://developers.openai.com/plugins/deploy/submission#automatically-provide-submission-and-review-information).
In the portable root `plugin.json`, `interface`, `review` and `publication` are
siblings under `extensions.com.openai`; never nest review/publication in
`interface`. Keep package `name`, `version`, author and other portable identity
fields at the root. Reconcile reference copy with the current product and
maintained listing before applying it; legacy category enum values must match a
current dashboard category title.

| Legacy reference | Current package destination |
| --- | --- |
| `app_info.display_name` | `extensions.com.openai.interface.displayName` |
| `app_info.subtitle` / `app_info.description` | `interface.shortDescription` / `interface.longDescription` under `extensions.com.openai` |
| `app_info.category` | `extensions.com.openai.interface.category`, using the supported category title |
| `developerName`, resolved website/support/privacy/terms references | `extensions.com.openai.interface.developerName`, `websiteURL`, `supportURL`, `privacyPolicyURL`, `termsOfServiceURL` |
| `starterPrompts` and resolved icon references | `extensions.com.openai.interface.defaultPrompt`, `composerIcon`, `logo`; bundle referenced assets with `./` paths relative to the plugin root |
| `test_cases` | `extensions.com.openai.review.test_cases.positive`: preserve `description` and `tools_triggered`, map `user_prompt` → `prompt` and `expected_output` → `expected_behavior` |
| `negative_test_cases` | `extensions.com.openai.review.test_cases.negative`: preserve `description`, map `user_prompt` → `prompt` |
| Reviewer-accessible demo video | `extensions.com.openai.review.demo_recording_url` |
| Current release notes / country targeting | `extensions.com.openai.publication.release_notes` / `countries`; omission preserves targeting, `[]` removes country restrictions |
| `localizations` | `extensions.com.openai.publication.translations`, keyed by each exact `portalLocale`, with its `subtitle` and `description` |
| `versionSource` | Root companion `plugin.json.version`, aligned during [release preparation](release/versioning.md#release-preparation); the registry version is a separate aligned surface |
| `mcpServerUrlSource` / `oauth` | Companion `mcp.json`: `mcpServers.nibomo.url` and, when needed, that server's `extensions["com.openai"].auth`, following the [authentication reference](https://developers.openai.com/plugins/build/plugins#configure-mcp-authentication) |

The legacy `tools` annotations and justifications are review rationale to compare
with actual server metadata and behavior; they do not override MCP scans or live
tool definitions and have no automatic listing-field mapping. Correct affected
metadata in server source and deploy/rescan under the canonical procedure.
Preserve OAuth discovery/DCR and the shared `https://mcp.nibomo.com/mcp` endpoint;
use the canonical procedure for locked connection settings or URL changes.

Five positive and three negative cases, a reviewer-accessible demo, and applicable
review details must describe verified behavior. Imported test cases are managed
by the ZIP: edit source and upload a complete corrected package to change them.
Omission or null preserves saved cases; an empty `test_cases` object clears both
lists. Check saved/imported values and findings; upload success does not prove
OAuth, creation, study, editing, submission or publication.

Private credentials and sign-in instructions belong only in secure **Review
details**, outside source and ZIPs; package metadata rejects `test_credentials`
and `reviewer_instructions`. The publisher account `kirill@kirill-markin.com`
is distinct from that dedicated Nibomo reviewer account. Keep secrets, tokens,
client secrets and nonempty server headers out of the package.

## Translation mapping and availability

The legacy metadata file supplies 46 translated subtitles and descriptions plus
English reference copy. Its `sourceLocale` identifies the product locale and
`portalLocale` identifies the exact translation key. Preserve mappings such as
`es-MX` → `es-419` and `es-ES` → `es-ES`; do not substitute product locale keys.
English belongs in base `interface` fields; an `en-US` translation is not
required or generated. Hebrew (`he`), Persian (`fa`) and Zulu (`zu`) have no
matching option in the reference portal mapping; recheck current support before
claiming additional listing coverage.

Translated subtitles are single lines of at most 30 characters and descriptions
at most 4,000. Copy reviewed values into
`extensions.com.openai.publication.translations.<portalLocale>`; `sourceLocale`
and `portalLocale` remain reference mapping fields, not fields inside the
translation entry. Follow the official [translation import behavior](https://developers.openai.com/plugins/deploy/submission#translate-listing-text):
translations are validated and retained in the uploaded bundle, but importing
them does not yet change Plugins Directory text or listing API responses.
Product language support, saved package translations and observed public listing
coverage are separate states. Record actual public locale evidence in the
[release ledger](release/evidence.md#release-ledger); neither a JSON reference,
a successful import nor an approved package proves public language coverage.
