# Release Notes

Read the [release entry point](README.md) for authorization, completion, and
required reading, and the mandatory [shared evidence rules](evidence.md) before
following this procedure.

Write notes for selected releases that need them. Compare each target with
the source of its last version actually released to users. Include relevant
changes from any App Store submission
[replaced while in review](ios.md#replacing-a-version-still-in-review).
Inspect the implementation when a change's platform or visible effect is
unclear.

Prepare separate texts for each destination.

- For **iOS/iPadOS, Android phone and Wear OS**, pre-generate localized notes
  for each selected app or track using its own last public version. Cover
  changes users will experience there and share text only when those changes
  match. Exclude web, admin, plugin and Mac-only changes. Include backend
  changes only for their visible effect in the corresponding native app. When
  a mobile release contains only bug fixes or performance improvements, say so
  without borrowing features from another platform.
- **macOS:** prepare separate localized Mac notes for changes available in the
  Catalyst app; do not copy Mac-only UX improvements into mobile notes.
- **GitHub Release** gets a fuller English changelog for the selected release
  scope. Name the platforms where each change is available.

For every destination:

- Describe visible changes in short, plain bullets, most important first.
- Omit internal refactors, tests, CI/CD, and infrastructure details unless users
  notice the result; group small changes as bug fixes or performance improvements.
- Put one fenced `text` block per destination and locale in the chat, with the
  destination and locale labels outside and only flat `-` release-note bullets
  inside. These are reusable inputs for the operator, including an AI continuing
  the same task; do not stop to ask the user to copy or approve them.
- For store notes, use every locale in the order in
  [Supported App Locales](../ios-localization.md#supported-app-locales).
  Keep `es-MX` and `es-ES` separate. Map store locale identifiers using
  [Locale tags per surface](../add-language.md#locale-tags-per-surface) and the
  [App Store](../app-store-connect-metadata.md) /
  [Google Play](../google-play-store-metadata.md) metadata guides. If the current
  store draft requires additional locales, prepare and retain those texts too.
- Use each text only in its intended destination's What's New/release notes
  fields or GitHub Release. Never publish the raw generated commit, PR,
  or contributor list as release notes; the only contributor addition is the
  [GitHub Release thanks](#github-release-thanks) line.

## GitHub Release thanks

When publishing a GitHub Release here or in `kirill-markin/nibomo-plugins`,
append one line to its English notes naming every other human commit author in
that repository's range from the previous release tag to the current one:

```bash
gh api --paginate "repos/<owner>/<repo>/compare/<previous-tag>...<tag>?per_page=100" \
  --jq '.commits[].author.login // empty' | sort -u
```

Write `@login` handles, for example `Thanks to @murlexander and @Noah-zipit`.
Exclude the maintainer `kirill-markin`, `[bot]` logins, and AI accounts; ignore
`Co-authored-by` trailers. Omit the line when nobody else contributed. Store
release notes never carry it.

## Android draft upload input

The optional `localized_release_notes` input for `Android Release` applies
only to the phone draft. Supply its notes as a JSON list of exact
`{language,text}` records. Enter Wear OS notes directly in its Play Console draft.
Use the Play codes in [canonical metadata](../google-play-store-metadata.md) and
[locale mapping](../../apps/android/docs/play-store-localization-runbook.md#1-confirm-the-surface-and-locale-set),
including `en-US`, `es-419`, and `iw-IL` rather than app language aliases.
Each locale occurs once, with nonempty text of at most
[500 Unicode characters](https://support.google.com/googleplay/android-developer/answer/9859348?hl=en).
The workflow accepts the current authored Play locale set; update its
[parser locale set](../../scripts/android/play_release_notes.py) when adding a listing.
The following example illustrates the input shape; supply the release-specific
texts for every required locale:

```json
[
  {"language": "en-US", "text": "- Improved offline reviews.\n- Fixed card editing."},
  {"language": "es-419", "text": "- Mejoramos los repasos sin conexión.\n- Corregimos la edición de tarjetas."}
]
```

When the input is empty, enter the phone notes in Console.
`[]`, duplicate locales, app-only aliases, blank text and oversized texts fail
preflight before builds/device tests. The exact input is retained in a separate
`android-release-notes-r<runId>a<attempt>` artifact with target SHA, version name,
version code and original run/attempt binding; its SHA-256 is printed in preflight.
The publisher verifies that evidence and includes Google's
[`releaseNotes`](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks#Release)
in the existing guarded draft edit. Review the saved texts in Console before
publication. [Exact-bundle recovery](android.md#exact-bundle-upload-recovery)
reuses that original input and permits no replacement notes.
