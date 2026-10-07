# Release Notes

Read the [release entry point](README.md) for authorization, completion, and
required reading, and the mandatory [shared evidence rules](evidence.md) before
following this procedure.

Compare the release target with the previous version actually released to users.
Start with the commit range between that tag and the target; inspect code only
where the user-visible effect is unclear.

- Describe visible changes in short, plain bullets, most important first.
- Omit internal refactors, tests, CI/CD, and infrastructure details unless users
  notice the result; group small changes as bug fixes or performance improvements.
- Put one fenced `text` block per locale in the chat, with the locale label
  outside and only flat `-` release-note bullets inside. These are reusable
  inputs for the operator, including an AI continuing the same task; do not
  stop to ask the user to copy or approve them.
- Use every locale in the order in
  [Supported App Locales](../ios-localization.md#supported-app-locales).
  Keep `es-MX` and `es-ES` separate. Map store locale identifiers using
  [Locale tags per surface](../add-language.md#locale-tags-per-surface) and the
  [App Store](../app-store-connect-metadata.md) /
  [Google Play](../google-play-store-metadata.md) metadata guides. If the current
  store draft requires additional locales, prepare and retain those texts too.
- Reuse these texts in each store's What's New/release notes fields; use the
  English text for GitHub Release. Never publish the raw generated commit, PR,
  or contributor list as release notes.

## Android draft upload input

Prepare the reviewed texts above as the optional `localized_release_notes`
`Android Release` dispatch input: a JSON list of exact `{language,text}` records.
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

Leaving the input empty preserves the flow where notes are entered in Console.
`[]`, duplicate locales, app-only aliases, blank text and oversized texts fail
preflight before builds/device tests. The exact input is retained in a separate
`android-release-notes-r<runId>a<attempt>` artifact with target SHA, version name,
version code and original run/attempt binding; its SHA-256 is printed in preflight.
The publisher verifies that evidence and includes Google's
[`releaseNotes`](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks#Release)
in the existing guarded draft edit. Review the saved texts in Console before
publication. [Exact-bundle recovery](android.md#exact-bundle-upload-recovery)
reuses that original input and permits no replacement notes.
