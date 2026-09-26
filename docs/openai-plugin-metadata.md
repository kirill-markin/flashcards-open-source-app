# OpenAI directory metadata

[chatgpt-app-submission.json](chatgpt-app-submission.json) is the uploadable
source for English app info, tool annotations and justifications, five test
cases, and three negative test cases. It follows OpenAI's
[submission schema](https://developers.openai.com/plugins/schemas/chatgpt-app-submission.v1.json).

[openai-plugin-metadata.json](openai-plugin-metadata.json) owns the other public
portal settings and 46 translated subtitles and descriptions. Its `baseLocale`
references the English copy in the submission file; `sourceLocale` and
`portalLocale` give the exact product-to-directory mapping. Together they cover
47 product locales. Hebrew (`he`), Persian (`fa`), and Zulu (`zu`) have no
matching option in the portal. Product language support, saved directory
translations, and published listing coverage are separate states.

The metadata file is a repository source, not an OpenAI upload format. The
uploader handles `app_info`, `tools`, `test_cases`, and `negative_test_cases`;
it ignores a top-level `translations` array. The schema's permissive
`additionalProperties` does not establish support for other fields. Apply the
remaining settings and translations in the portal.

## Update an editable draft

1. Review both JSON files against the current product. Keep subtitles within
   30 characters and descriptions within 4,000. The translation editor exposes
   only subtitle and description; preserve the two Spanish locale mappings.
2. Set the portal version from `version` in [server.json](../server.json).
   Resolve the relative file and JSON Pointer references in the metadata file
   for the website, support, privacy, terms, MCP URL, and icons. Do not copy a
   version number or those shared URLs into a second source.
3. Upload `chatgpt-app-submission.json` through the draft's import control.
   Import updates the draft immediately. Confirm the summary reports updated
   app info, five test cases, three negative test cases, and eight tool
   justifications, with no missing, skipped, or mismatched tools. Read the
   saved values back. Import neither scans the MCP server nor submits or
   publishes the app; omitted fields remain separate portal settings.
4. Apply the other public settings from `openai-plugin-metadata.json`. In
   Translations, add each `portalLocale` and enter its reviewed subtitle and
   description. Wait for saving to finish, reopen each locale, and compare
   both saved fields with the source. Read the version and other settings
   back as well.
5. Keep reviewer access instructions and video delivery outside these public
   files. Complete them and any required confirmations in the portal before
   following OpenAI's [submission procedure](https://developers.openai.com/plugins/deploy/submission).

Updating repository copy or the editable draft does not prove that a language
has been published. Check the actual listing after approval and publication.
