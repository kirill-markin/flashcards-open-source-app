# Review Markdown Rendering

This document is the cross-client semantic contract for Markdown on review card
sides. Web keeps browser-native output, iOS keeps SwiftUI-native output, and
Android keeps Material 3-native output. The rendered structure and behavior must
match, but typography, spacing, and other platform styling do not need to be
pixel-identical.

## Presentation selection

Review content keeps three presentation modes: short plain text, paragraph plain
text, and Markdown. Existing word, character, and multiline thresholds continue
to choose between the two plain-text modes.

An ordinary Markdown link or image is a Markdown presentation cue on every
client. Inline emphasis by itself does not change presentation selection. For
example, `A **short** answer` remains subject to the existing plain-text
selection policy unless the same content contains another Markdown cue.

## Markdown subset

Once a card side is classified as Markdown, every client supports this shared
GFM subset:

- headings
- strong and emphasized text
- strikethrough
- ordered and unordered nested lists
- blockquotes
- inline and fenced code
- thematic breaks
- links
- tables
- images

Raw HTML and LaTeX are unsupported. Card content must not depend on either
syntax being interpreted.

## Managed media

Managed media persists in card text as one of these forms:

```text
![label](fcasset:<mediaAssetId>)
[label](fcasset:<mediaAssetId>)
```

Outside fenced code, clients render these references with their existing
managed-media UI. An `fcasset:` URL must never be sent to a generic network
image loader. Inside fenced code, the same text is literal code and must not
start a managed-media load.

## Manual parity sample

Create or edit one card side on Web and iOS, paste the sample below, and replace
the final placeholder line by inserting a recognizable image through the app's
image action. Do not type or invent an asset id. The app-generated card text at
that position must use `![label](fcasset:<mediaAssetId>)`.

````markdown
# Review Markdown parity

Paragraph with **strong**, *emphasis*, ~~strikethrough~~, and `inline code`.
中文标点紧邻**重点**，继续。

- Unordered item
  - Nested unordered item
1. Ordered item
   1. Nested ordered item

> Blockquote with an [ordinary HTTPS link](https://flashcards-open-source-app.com).

| Construct | Expected |
| --- | --- |
| Table | Two columns |

---

```text
Literal managed reference: ![not media](fcasset:literal-inside-fence)
```

![Ordinary HTTPS image](https://raw.githubusercontent.com/kirill-markin/flashcards-open-source-app/main/apps/web/public/icon-preview.png)

Managed image inserted through the app:
[REPLACE THIS LINE USING THE APP IMAGE ACTION]
````

On both clients, confirm:

- headings, inline styles, nested lists, the blockquote, table, thematic break,
  and code have equivalent document structure
- strikethrough and the CJK-adjacent emphasis render without consuming adjacent
  punctuation
- the HTTPS link is interactive and the HTTPS image uses the ordinary image path
- the inserted managed image uses the native managed-media path and remains
  available from local media after it has been cached
- the fenced `fcasset:` example stays literal and does not trigger media loading

Platform-native typography and spacing differences are expected.
