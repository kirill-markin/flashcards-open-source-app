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
Recognized inline or display math is also a Markdown presentation cue. Escaped
or unbalanced dollar signs and dollar signs inside code are not math cues.

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
- inline and display math

Raw HTML is unsupported. Full TeX documents, custom packages, DOM commands, and
platform-specific syntax are also unsupported. Card content must not depend on
those forms being interpreted.

## Math syntax

Outside code, an unescaped single dollar sign opens inline math and the next
unescaped single dollar sign on the same line closes it. The content between the
delimiters is the LaTeX source. Inline math cannot span lines.

Display math opens and closes with separate delimiter lines. Each delimiter line
contains only optional spaces or tabs and exactly `$$`; the body between them may
span lines. A `$$` token anywhere else is literal text.

Outside code, `\$` produces a literal dollar sign and cannot open or close math.
Currency dollar signs therefore need escaping, for example `\$5` and `\$10`.
Any inline or display delimiter without a matching close remains literal,
including its opening delimiter.

Fenced code blocks and inline code spans take precedence over math and are never
scanned for math delimiters. Math recognition applies only to Markdown text
content, not link or image destinations, so it does not reinterpret `fcasset:`
managed-media URLs. Existing managed-media parsing and rendering behavior is
unchanged.

Applications maintain no LaTeX command allowlist. Every expression that RaTeX
accepts is eligible to render. This does not extend support to full TeX
documents, custom packages, DOM commands, or platform-specific syntax that
RaTeX does not accept.

## Math rendering and accessibility

Inline formulas participate in the surrounding text flow. Display formulas are
top-level blocks with horizontal scrolling so wide formulas do not resize or
clip the card.

When RaTeX rejects a recognized formula, the formula remains visibly
represented by its original delimited source, the UI exposes an explicit render
error, and the client logs the underlying RaTeX error. A rejected formula must
not disappear or degrade to an empty placeholder.

Speech output and accessibility labels expose the LaTeX source between the
delimiters, without the opening or closing dollar signs.

## Compact math parity fixture

For a runnable fixture, replace `<mediaAssetId>` with an asset ID inserted
through the app's image action; do not type or invent an asset ID.

````markdown
Inline math: $E = mc^2$ and currency: \$5.

Inline code keeps dollars literal: `$not_math$`.

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$

```text
$also_not_math$ and $$
```

![Managed image](fcasset:<mediaAssetId>)

Invalid recognized formula: $\frac{1}{$
````

Every client must produce equivalent semantics: the inline and display formulas
render in their respective layouts; the escaped dollar and code examples stay
literal; the managed image uses the existing native managed-media path; and the
invalid formula remains visible with an explicit render error while its
underlying RaTeX error is logged.

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
