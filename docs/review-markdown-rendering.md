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
Eligible inline-source or display math is also a Markdown presentation cue.
Literal math forms described below, escaped or unbalanced dollar signs, and
dollar signs inside code are not math cues.

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
- inline-source and display math rendered as standalone blocks

Raw HTML is unsupported. Full TeX documents, custom packages, DOM commands, and
platform-specific syntax are also unsupported. Card content must not depend on
those forms being interpreted.

## Math syntax

Outside code, an unescaped single dollar sign opens inline-source math and the
next unescaped single dollar sign on the same logical line closes it. The
content between the delimiters is the LaTeX source. Inline-source math cannot
span lines.

Display math opens and closes with separate delimiter lines. Each delimiter line
contains only optional spaces or tabs and exactly `$$`; the body between them may
span lines. A `$$` token anywhere else is literal text.

Outside code, `\$` produces a literal dollar sign and cannot open or close math.
Currency dollar signs therefore need escaping, for example `\$5` and `\$10`.
Any inline-source or display delimiter without a matching close remains
literal, including its opening delimiter.

Fenced and indented code blocks and inline code spans take precedence over math
and are never scanned for math delimiters. Inline-source math is eligible only
in a top-level plain paragraph whose children are ordinary text or formula
spans. Display math is eligible only as a direct top-level document block.

Math nested inside links, images or managed-media labels, emphasis, strong,
strikethrough, headings, lists, blockquotes, tables, code, autolinks, or raw HTML
remains literal. If a card side contains any reference-style link or image
definition, V1 performs no math segmentation anywhere on that side and all
dollar-delimited source remains literal. Ineligible or unbalanced delimiters
also remain literal. These outcomes are deliberate V1 product behavior, not
cases for clients to recover by reconstructing the full CommonMark source.

Math recognition does not reinterpret link or image destinations, including
`fcasset:` managed-media URLs. Stored card data, APIs, sync, and existing
managed-media parsing and rendering behavior are unchanged.

Applications maintain no LaTeX command allowlist. Every expression that RaTeX
0.1.14 accepts is eligible to render. This does not extend support to full TeX
documents or commands and syntax that RaTeX does not support.

## Math rendering and accessibility

Every accepted formula renders in display style as a standalone horizontally
scrollable block so wide formulas do not resize or clip the card. Eligible
inline-source math splits its top-level paragraph into ordered Markdown and
formula segments. For example, `Before $x$ after` renders as Markdown `Before`,
a formula block for `x`, and Markdown `after`.

When RaTeX rejects a recognized formula, the formula remains visibly
represented by its original delimited source, the UI exposes a localized render
error, and the client logs the underlying RaTeX error. A rejected formula must
not disappear or degrade to an empty placeholder.

Speech output and accessibility labels expose the LaTeX source between the
delimiters, without the opening or closing dollar signs.

## Compact math parity fixture

Treat each numbered source below as a separate card side. For the managed-media
case, replace `<mediaAssetId>` through the app's image action; do not type or
invent an asset ID.

1. `Before $x$ after` becomes Markdown `Before`, a display-style block for `x`,
   and Markdown `after`.
2. A top-level display block renders as one horizontally scrollable formula:

   ```markdown
   $$
   \int_0^1 x^2\,dx = \frac{1}{3}
   $$
   ```

3. `Price: \$5` keeps the escaped dollar literal.
4. Inline, fenced, and indented code keep dollar-delimited text literal:

   ````markdown
   `$inline_code$`

   ```text
   $fenced_code$
   ```

       $indented_code$
   ````

5. `[$link_label$](https://flashcards-open-source-app.com)` keeps the link-label
   math literal.
6. `**$strong$**` keeps the strong math literal.
7. `- $list_item$` keeps the list math literal.
8. `![Managed $label$](fcasset:<mediaAssetId>)` uses the existing managed-media
   path and does not render label math.
9. This complete side contains a reference-style definition, so it performs no
   math segmentation and keeps `$x$` literal:

   ```markdown
   Reference side with $x$ and [documentation][docs].

   [docs]: https://flashcards-open-source-app.com
   ```

10. `Unbalanced $x` remains literal.
11. `Invalid $\frac{1}{$` is a recognized formula; it remains visible with its
    delimiters, a localized render error, and a logged underlying RaTeX error.

Speech and accessibility expose `x`, `\int_0^1 x^2\,dx = \frac{1}{3}`, and
other recognized formula sources without delimiters. Web, Android, and iOS
implement the rendering contract above. Transport escaping and read-back
authoring rules use the canonical shared AI authoring contract in
`apps/backend/src/aiTools/toolContract/sqlToolContract.ts`.

## Managed media

Managed media persists in card text as one of these forms:

```text
![label](fcasset:<mediaAssetId>)
[label](fcasset:<mediaAssetId>)
```

Generated images use an image-only lifecycle reference on the exact requested
card side:

```text
pending = ![label](fcasset:<mediaAssetId>?state=pending)
ready   = ![label](fcasset:<mediaAssetId>)
failed  = ![label](fcasset:<mediaAssetId>?state=failed)
```

The pending marker is written atomically with durable background-promotion
admission. Successful promotion removes the query state; terminal failure
changes `state=pending` to `state=failed`. Card text never contains a localized
status sentence, staging URL, or image payload. Each client owns localized
pending and failed presentation and extracts the media asset ID before the query
parameters. Pending and failed references are not exportable or publishable
managed media.

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
