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
