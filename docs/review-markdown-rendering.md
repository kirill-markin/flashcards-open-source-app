# Review Markdown Rendering

This document is the cross-client semantic contract for Markdown on review card
sides. Four surfaces are bound by it: the web app review screen, the iOS app
review screen, the Android app review screen, and the public catalog website
(`flashcards-open-source-app-website`, a sibling repository). Web keeps
browser-native output, iOS keeps SwiftUI-native output, Android keeps Material
3-native output, and the catalog website keeps its own web output. The rendered
structure and behavior must match, but typography, spacing, and other platform
styling do not need to be pixel-identical.

The three apps render math with RaTeX 0.1.14; the catalog website renders it
with KaTeX (`katex` through `rehype-katex`). The segmentation rules below bind
all four identically. Where two engines can legitimately disagree on the same
accepted formula source, only surfaces that share an engine owe each other
identical output, and this document says so at the point where it matters.

## Presentation selection

Review content keeps three presentation modes: short plain text, paragraph plain
text, and Markdown. Existing word, character, and multiline thresholds continue
to choose between the two plain-text modes.

An ordinary Markdown link or image is a Markdown presentation cue on every
client. Inline emphasis by itself does not change presentation selection. For
example, `A **short** answer` remains subject to the existing plain-text
selection policy unless the same content contains another Markdown cue.
Accepted inline or display math is also a Markdown presentation cue. Literal
math forms described below, escaped dollar signs, dollar signs that fail the
delimiter guards, unbalanced dollar signs, and dollar signs inside code are not
math cues.

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
- inline math and standalone display math

Raw HTML is unsupported. Full TeX documents, custom packages, DOM commands, and
platform-specific syntax are also unsupported. Card content must not depend on
those forms being interpreted.

## Math syntax

Math delimiters follow the published `$`-math rules rather than a dialect of
this product: inline math uses the pandoc `tex_math_dollars` guards, and display
math uses the `micromark-extension-math` fence grammar that already powers
`remark-math` in this repository. Where this product deliberately narrows or
extends those rules, the text below says so.

Throughout these rules, *space* means exactly the ASCII space (U+0020), the
ASCII tab (U+0009), and the line break that ends a line. Every other character
is a non-space character, including the non-breaking space (U+00A0) and every
other Unicode space character. Implementations must not delegate the delimiter
guards to a language's general whitespace predicate, because JavaScript, Swift,
and Kotlin do not agree on which code points such a predicate covers.

Outside code, a run of two or more consecutive unescaped `$` is always a display
fence sequence and is never read as a pair of inline delimiters. Only a run of
exactly one `$` can delimit inline math. A run is maximal, covering every
consecutive `$`, so `$$$` is one run of three rather than a run of two followed
by a single `$`. That precedence is settled before any inline scan, so a `$$`
run that does not form an eligible display fence stays literal instead of
falling back to inline math, and inline scanning continues past it on the same
line. This is a deliberate narrowing, not inherited behavior: both cited
standards read `$$E=mc^2$$` inside a sentence as math, because micromark text
math accepts sequences of two or more `$` and pandoc reads the same source as
display math. A client built on `remark-math` is
therefore handed an `inlineMath` node whose delimited source begins with `$$`,
and must keep it literal rather than render it.

An unescaped single `$` opens a candidate inline span when the pandoc opening
guard holds: it has a non-space character immediately to its right. The scan
then continues on the same logical line, and the span closes at the first later
unescaped single `$`; the scan never skips that `$` to look for a better closer.
The span is math only when that closer also satisfies the pandoc closing guard:
a non-space character immediately to its left, and no digit immediately to its
right. When the closer fails a guard, the attempt fails, the opening `$` stays
literal, and the `$` that failed as a closer is itself the next candidate
opener, re-tested from scratch against the opening guard. When the scan instead
reaches a run of two or more `$`, the attempt fails there, the opening `$` stays
literal, and the scan continues after that whole run. When the line holds no
later `$` at all, the attempt fails and nothing on that line is left to scan.
After an accepted pair, scanning continues at the character following the
closing `$`, so one line may hold several accepted spans. The content between an
accepted pair is the LaTeX source, and inline math cannot span lines. So
`Earned value is $80,000 and actual cost is $100,000.` stays ordinary prose,
while in `A $100 bond with yield $r$ pays` only `r` becomes a formula and
`$100 bond with yield ` stays literal.

Display math opens with a run of two or more unescaped `$` and closes with a run
holding exactly as many `$` as the opening run; a run that is shorter or longer
never closes it. Each shape below names the one run that has to be that closing
run, and when that run holds a different number of `$` the construct opens no
display fence and the whole source stays literal. On the single-line shape the
equal-length requirement costs a `remark-math` client nothing, because micromark
text math closes a run of *n* `$` only on a later run of exactly *n*, so a
strictly longer closing run produces no node to promote, while a hand-written
scanner would happily accept it. On the multiple-line shape it is a real product
restriction that every client enforces with its own check against the source:
micromark flow math accepts a closing run longer than the opening one, so `$$`,
`X`, and `$$$` on three lines arrives as a valid flow math node holding `X`,
which this contract rejects.

The opening run must begin its own top-level block, which means all three of:

- at most three spaces, and no tab, precede it on its line, because four spaces
  or a leading tab make the line indented code, which is never scanned for math;
- that line is the first line of the card side or is preceded by a blank line;
- that line is a direct top-level block of the card side, not a line inside a
  list item, blockquote, table, or any other container block.

Exactly two shapes are display math:

- Single line. The closing run is the first later run of `$` on that line;
  nothing but spaces or tabs may separate it from the end of that line; and that
  line also ends its block, being the last line of the card side or followed by
  a blank line. `$$E = mc^2$$` alone in its own block is display math for
  `E = mc^2`.
- Multiple lines. Only spaces or tabs follow the opening run to the end of its
  line, and the closing run is the run on the first later line whose whole
  content is one `$` run, at most three spaces and no tab before it and only
  spaces or tabs after it. The lines between the two runs are the formula body,
  and a `$` inside that body is never a closer. Only this shape may be followed
  directly by more content: the closing run's own line already ends the
  construct, so a text line may follow it without a blank line and becomes an
  ordinary paragraph.

Every other arrangement of a `$$` run opens no display fence and stays literal.
In particular:

- A single-line `$$…$$` that immediately follows a text line belongs to that
  paragraph rather than starting a block, so `Answer:` followed on the next line
  by `$$E = mc^2$$` yields no display block and leaves both runs literal inside
  the paragraph. Upstream does not protect the multiple-line shape the same way:
  flow math does interrupt a paragraph, so `Answer:` followed by `$$`,
  `E = mc^2`, and `$$` arrives as a paragraph plus a valid flow math node. Only
  the client's own check for the blank line before the opening run keeps it
  literal, and this contract requires that check.
- Two multiple-line constructs with no blank line between them are two valid
  flow math nodes upstream but only one accepted construct here: the second
  opening run is preceded by the first closing run rather than by a blank line,
  so the second construct stays literal and its three lines become an ordinary
  paragraph. This too needs the client's own source check.
- A single-line construct that does not also end its block stays literal, so
  `$$E = mc^2$$` followed on the next line by `Answer text.` is one literal
  paragraph, and `$$A$$` followed on the next line by `$$B$$` is one literal
  paragraph too.
- A line carrying two single-line constructs stays literal, because the closing
  run is the first later run on that line and more text follows it there:
  `$$E=mc^2$$ $$F=ma$$` alone in its own block is literal, and its body is never
  `E=mc^2$$ $$F=ma`.
- Text between the opening run and the end of its line is never a formula body,
  so `$$E = mc^2` followed by a line holding only `$$` is not display math
  either, and both lines stay literal; upstream that shape parses as a fence
  whose body is empty and whose `meta` is `E = mc^2`, which would render an
  empty formula, and this product rejects it rather than rendering nothing.

The source-level rules above are the single normative test for display math. The
three paragraphs that follow are informative: they describe what a `remark-math`
client receives, so that such a client can implement the test, and they add no
rule.

`remark-math` never produces a flow math node for a `$$` run that opens and
closes on one line; micromark reads that shape as text math instead, so
`$$E = mc^2$$` alone in its own block arrives as a paragraph holding a single
`inlineMath` child whose delimited source opens and closes with a run of two or
more `$`. Such a client promotes that node to display math when, and only when,
the source-level rules above accept the source it came from, and keeps every
other `$$`-delimited text-math node literal, delimiters included. The node shape
is a consequence of those rules rather than a second test of them, and it is a
looser shape than they are: micromark also yields `inlineMath` children for
`$$E = mc^2$$` followed by a text line, for `$$A$$` and `$$B$$` on consecutive
lines, and for `$$E=mc^2$$ $$F=ma$$` on one line, and the source-level rules
reject all three, so a client keeps all three literal. Already published card
sides depend on single-line display math, so the rule must not be weakened.

On the multiple-line shape a client is handed real flow math nodes, and upstream
is looser than this contract there in three specific ways, so a client that
trusts the node it was handed renders all three wrongly. Flow math interrupts a
paragraph, so a `$$` line directly after a text line still yields a math node.
Flow math accepts a closing run longer than the opening run. Two multiple-line
constructs with no blank line between them yield two math nodes. Each of the
three is caught only by re-reading the source around the node — the blank line
before the opening run, and the length of the closing run — never by the node
itself.

The same holds for every math node upstream hands over, `$`-delimited as well as
`$$`-delimited: text math is produced for boundaries the guards above reject, so
`Cost is $x and$$E$$ here$m$ ok.` arrives with an `inlineMath` node holding
`x and$$E$$ here`, which item 25 forbids, and `$$a $ b$$` alone in its block
arrives as an `inlineMath` node holding `a $ b`, whose closing run is one `$`
where the opening run held two. Every math node must be re-validated against the
source rules above, and upstream node boundaries are never authoritative on
their own.

Outside code, `\$` produces a literal dollar sign and cannot open or close math.
Escaping stays the reliable way to write currency, for example `\$5` and `\$10`.

Any inline or display delimiter without a matching close stays literal in place,
including its opening delimiter, and the rest of the card side is unaffected and
still parses as ordinary Markdown, keeping its emphasis, lists, and every other
construct. That is a deliberate product rule rather than upstream behavior: an
unterminated micromark flow fence runs to the end of the input and swallows the
Markdown inside it, so `$$` followed by `E = mc^2`, a blank line, and
`after **bold** text` becomes one flow math node whose value is that whole
remainder, blank line and unrendered `**bold**` included. Every client needs an
explicit guard that keeps the opening run literal and returns the swallowed
remainder to ordinary Markdown parsing.

Fenced and indented code blocks and inline code spans take precedence over math
and are never scanned for math delimiters. Inline math is eligible only in a
top-level plain paragraph whose children are ordinary text or formula spans.
Display math is eligible only as a direct top-level document block.

Math nested inside links, images or managed-media labels, emphasis, strong,
strikethrough, headings, lists, blockquotes, tables, code, autolinks, or raw HTML
remains literal. If a card side contains any reference-style link or image
definition, V1 performs no math segmentation anywhere on that side and all
dollar-delimited source remains literal. Ineligible or unbalanced delimiters
also remain literal. The standard allows math in those positions and this
product deliberately does not, because supporting them across four independent
implementations is not worth the cost yet. These outcomes are deliberate V1
product behavior, not cases for clients to recover by reconstructing the full
CommonMark source.

Math recognition does not reinterpret link or image destinations, including
`fcasset:` managed-media URLs. Stored card data, APIs, sync, and existing
managed-media parsing and rendering behavior are unchanged.

Applications maintain no LaTeX command allowlist. Every expression the surface's
math engine accepts is eligible to render: RaTeX 0.1.14 on the web, iOS, and
Android review screens, and KaTeX on the catalog website. This does not extend
support to full TeX documents or commands and syntax the engine does not
support.

## Math rendering and accessibility

An accepted inline formula renders in text style (`displayMode: false`) on the
surrounding text baseline and stays inside its paragraph. It never splits that
paragraph into separate blocks, so `Before $x$ after` renders as one line of
text.

An accepted display formula renders in display style as a standalone
horizontally scrollable block, so a wide formula does not resize or clip the
card.

When the math engine rejects a recognized formula, the formula remains visibly
represented by its original delimited source, the UI exposes a localized render
error, and the client logs the underlying engine error. A rejected formula must
not disappear or degrade to an empty placeholder.

Speech output and accessibility labels expose the LaTeX source between the
delimiters, without the opening or closing dollar signs.

## Compact math parity fixture

Treat each numbered source below as a separate card side; the few items that
name more than one side say so. For the managed-media case, replace
`<mediaAssetId>` through the app's image action; do not type or invent an
asset ID.

1. `Before $x$ after` becomes one line of text in one paragraph: the words
   `Before` and `after` with a text-style formula for `x` between them on the
   same baseline.
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
12. `$$E = mc^2$$`, alone in its own block — the first line of the side or
    preceded by a blank line, the last line of the side or followed by a blank
    line, and nothing but the end of the line after the closing `$$` — is
    display math and renders as one horizontally scrollable display-style
    block, exactly like item 2.
13. `Earned value is $80,000 and actual cost is $100,000.` stays entirely
    literal. The first `$` opens a candidate span, but the next `$` has a space
    immediately to its left, so it cannot close the span and the first `$` stays
    literal. Scanning resumes at that second `$`, which has no later `$` on the
    line, so it stays literal too.
14. `A $100 bond with yield $r$ pays` mixes currency and math on one line. The
    first `$` cannot close on the second `$`, which has a space to its left, so
    `A $100 bond with yield ` stays literal; scanning resumes at the second `$`,
    which closes on the third and yields a text-style formula for `r`, followed
    by literal ` pays`. The scan never skips the second `$` to close on the
    third, so the formula body is never `100 bond with yield $r`, and the side
    is never entirely literal.
15. `The formula $$E=mc^2$$ is famous.` stays entirely literal. Each `$$` is a
    display fence sequence rather than a pair of inline delimiters, and neither
    sequence starts its own line, so no display block is eligible and no inline
    span forms.
16. The opening and closing runs must hold the same number of `$`. Three
    sides, each alone in its own block: `$$$x$$$` is display math for `x`;
    `$$$x$$`, whose closing run is one `$` short, stays entirely literal; and
    `$$x$$$`, whose closing run is one `$` long, stays entirely literal too.
    The long case is literal on purpose: `remark-math` produces no node at all
    for it, so accepting it would put a hand-written scanner's output out of a
    `remark-math` client's reach.
17. A `$$` fence with no closing fence stays literal, including the opening
    fence, and the rest of the side still parses as ordinary Markdown:

    ```markdown
    $$
    E = mc^2

    The **rest** of the side.
    ```

    The `$$` line and `E = mc^2` render as one literal paragraph, and
    `The **rest** of the side.` renders as a second paragraph with `rest` in
    bold. Nothing after the unterminated fence is absorbed into a formula or
    stripped of its Markdown.
18. A single-line display construct never interrupts a paragraph. This complete
    side yields no display block and keeps both `$$` runs literal inside the
    paragraph, because the `$$` line follows a text line instead of starting its
    own block:

    ```markdown
    Answer:
    $$E = mc^2$$
    ```

    Item 29 is the multiple-line counterpart, where upstream does produce a
    display node and the client has to reject it.

19. This complete side stays entirely literal, because text between the opening
    run and the end of its line is never a formula body, so the construct opens
    no display fence:

    ```markdown
    $$E = mc^2
    $$
    ```

    It must not render as an empty display block, which is what the upstream
    `meta` reading produces.
20. `$$E=mc^2$$ where $m$ is mass.`, as its own block, keeps both `$$` runs
    literal and renders a text-style formula for `m` on the same line. The
    closing run is followed by more text on its line rather than by the end of
    the line, so the single-line display shape fails; the runs are display fence
    sequences and never inline delimiters, so they open no inline span; and
    inline scanning continues past them and accepts `$m$`. The side is never
    entirely literal.
21. `Cost: $ x$` stays entirely literal through the opening guard alone: the
    first `$` has a space immediately to its right and the second has the end of
    the line to its right, so neither opens a candidate span. An implementation
    missing that guard renders a formula for ` x` instead, because the closer's
    left character `x` and its end-of-line right context both satisfy the
    closing guard. Only the opening guard decides this item.
22. `Prices are $20$30` stays entirely literal through the digit clause of the
    closing guard: the second `$` has a non-space character to its left but is
    followed immediately by `3`, so it cannot close, and the line holds no later
    `$`. An implementation missing that clause renders a formula for `20`
    instead.
23. Guard spaces are ASCII only. Build a side whose text is `Total is $`, a
    non-breaking space (U+00A0), `x`, a second non-breaking space, then
    `$ today.`; insert both code points literally rather than typing ordinary
    spaces. U+00A0 is a non-space character for these guards, so both guards
    hold and the inline pair is recognized math whose source is the two
    non-breaking spaces around `x`. Two renderings pass: a formula rendered on
    the baseline with no `$` visible anywhere on the side, or the delimited
    source shown together with the visible localized render error of item 11.
    Look for that error affordance specifically; it is the only thing that
    separates the second passing rendering from the failing one, where the two
    `$` characters render as ordinary text and no error appears anywhere on the
    side. Every surface passes this item on its own by landing on either passing
    rendering. The web, iOS, and Android review screens share RaTeX 0.1.14, so
    those three must land on the same one of the two: record which one the first
    of them produces and require the other two to match it. The catalog website
    renders with KaTeX, which makes its own decision about U+00A0 in math mode,
    so it owes the three apps no parity here and passes on either rendering. An
    implementation that reaches for a general whitespace predicate here keeps
    the whole side literal and fails this item.
24. Inline math never spans lines. This complete side keeps both `$` literal,
    because neither line holds a later `$`:

    ```markdown
    Mass is $m
    and energy is$E today.
    ```

    An implementation that continues the scan onto the next line closes the
    first `$` on the second one, whose left character `s` and right character
    `E` both satisfy the closing guard, and wrongly renders a formula holding
    `m`, the line break, and `and energy is`.
25. `Cost is $x and$$E$$ here$m$ ok.` keeps `Cost is $x and$$E$$ here` literal,
    renders a text-style formula for `m`, and keeps ` ok.` literal. The first
    `$` opens a candidate span, the scan
    reaches the `$$` run, and the attempt fails there. The scan neither closes
    on a `$` that belongs to a run of two or more nor skips the run to close on
    the `$` before `m`, either of which would render a formula for `x and` or
    for `x and$$E$$ here`.
26. The single-line display shape needs the whole block to itself. Each of these
    three complete sides stays entirely literal, with every `$` visible as
    ordinary text and no display block anywhere:

    - `$$E = mc^2$$` on the first line and `Answer text.` on the second, with no
      blank line between them: the `$$` line does not end its block, so both
      lines render as one literal paragraph.
    - `$$A$$` on the first line and `$$B$$` on the second, with no blank line
      between them: the first line does not end its block and the second does
      not start one, so all four runs stay literal in one paragraph.
    - `$$E=mc^2$$ $$F=ma$$` alone on its own line: the closing run is the first
      later run on the line, and more text follows it there, so the shape fails.
      The body is never `E=mc^2$$ $$F=ma`, and the second construct is not
      display math either.

    A `remark-math` client is handed `inlineMath` nodes on all three sides and
    must keep every one of them literal.
27. `where $m$ is mass and $c$ is the speed of light` becomes one line of text
    in one paragraph: a text-style formula for `m` and another for `c`, both on
    the same baseline as the surrounding words. Scanning continues after a
    successful close, so an implementation that stops at the first accepted span
    leaves `$c$` literal and fails this item.
28. Display math inside a container block stays literal. This complete side
    renders as an ordinary list whose single item shows `$$`, `E = mc^2`, and
    `$$` as text, with no display block anywhere:

    ```markdown
    - Item:

      $$
      E = mc^2
      $$
    ```

    The `$$` line carries fewer than four leading spaces and is preceded by a
    blank line, so it passes the two line-level tests in isolation. It is still
    literal, because the line is not a direct top-level block of the card side.
29. The multiple-line shape needs the blank-line check written into the client,
    because upstream does not supply it. This complete side stays entirely
    literal, as one paragraph showing `Answer:`, `$$`, `E = mc^2`, and `$$` as
    text, with no display block anywhere:

    ```markdown
    Answer:
    $$
    E = mc^2
    $$
    ```

    Unlike its single-line counterpart in item 18, this side arrives from
    `remark-parse` with `remark-math` as a paragraph holding `Answer:` plus a
    valid flow math node holding `E = mc^2`, because flow math interrupts a
    paragraph. A client that renders the node it was handed produces a display
    block and fails this item; only a source check for the blank line before the
    opening `$$` keeps it literal.
30. The multiple-line shape needs the equal-length check written into the client
    too. This complete side stays entirely literal, as one paragraph showing
    `$$`, `X`, and `$$$` as text:

    ```markdown
    $$
    X
    $$$
    ```

    Unlike the single-line long-run case of item 16, upstream hands over a valid
    flow math node holding `X` here, so there is a node to render and only the
    client's own comparison of the two run lengths rejects it.
31. Two multiple-line constructs need a blank line between them. This complete
    side renders one horizontally scrollable display block for `A`, followed by
    an ordinary paragraph showing `$$`, `B`, and `$$` as text:

    ```markdown
    $$
    A
    $$
    $$
    B
    $$
    ```

    Upstream hands over two valid flow math nodes. The second opening run is
    preceded by the first closing run rather than by a blank line, so only the
    client's own source check keeps the second construct literal. Inserting a
    blank line between the two constructs makes both of them display blocks.

Speech and accessibility expose `x`, `\int_0^1 x^2\,dx = \frac{1}{3}`, and
other recognized formula sources without delimiters. The web app review screen,
the iOS app review screen, the Android app review screen, and the public catalog
website implement the rendering contract above. Transport escaping and read-back
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
