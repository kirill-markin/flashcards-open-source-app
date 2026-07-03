# Marketing Links

Store campaign links use coarse campaign buckets. Do not create per-user,
per-page, per-button, or per-deck store campaign values.

Current campaign buckets:

| Bucket | Use |
| ------ | --- |
| `marketing_site` | Marketing landing pages and public content. |
| `share_app` | Future app share pages. |
| `share_deck` | Future deck share pages, grouped across decks. |
| `marketplace` | Future deck marketplace surfaces. |
| `web_review_mobile_prompt` | Web review mobile app promotion prompt. |

## Google Play

Use Google Play UTM parameters for Android store links:

- `utm_source=flashcards_website`
- `utm_medium=referral` for owned web-to-store links
- `utm_campaign=<bucket>`, starting with `marketing_site`

Current marketing-site Google Play URL:

`https://play.google.com/store/apps/details?id=com.flashcardsopensourceapp.app&utm_source=flashcards_website&utm_medium=referral&utm_campaign=marketing_site`

## App Store

Use App Store Connect campaign links for iOS store links, not `utm_*`.
Use `ct=<bucket>`, starting with `ct=marketing_site`.

Current marketing-site App Store campaign URL:

`https://apps.apple.com/app/apple-store/id6760538964?pt=128797295&ct=marketing_site&mt=8`

Keep the App Store Connect-generated URL as-is once generated; do not rewrite
the path manually.

Track fine-grained button placement in site or product analytics, not in store
campaign names.
