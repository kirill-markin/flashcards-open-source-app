import type { Nodes, Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import {
  escapeRejectedReviewMathDollars,
  hasEligibleReviewMath,
  splitEligibleReviewMathForSpeech,
  transformReviewMathBlocks,
} from "./reviewMathBlocks";

/**
 * Pins the compact math parity fixture of docs/review-markdown-rendering.md for
 * the web review screen. Item numbers below are that document's numbering.
 */
const reviewProcessor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const nonBreakingSpace = "\u00A0";

function transformCardSide(text: string): Root {
  const escapedText = escapeRejectedReviewMathDollars(text);
  return transformReviewMathBlocks(reviewProcessor.parse(escapedText), escapedText);
}

function describeChildren(children: ReadonlyArray<Nodes>): string {
  return children.map(describeNode).join("");
}

function describeNode(node: Nodes): string {
  if (node.type === "text") {
    return node.value;
  }
  if (node.type === "inlineMath") {
    return `[${node.value}]`;
  }
  if (node.type === "math") {
    return `display(${node.value})`;
  }
  if (node.type === "paragraph") {
    return `paragraph(${describeChildren(node.children)})`;
  }
  if ("children" in node) {
    return `<${node.type}:${describeChildren(node.children)}>`;
  }
  if ("value" in node) {
    return `<${node.type}:${node.value}>`;
  }

  return `<${node.type}>`;
}

function readReviewMathOutline(text: string): ReadonlyArray<string> {
  return transformCardSide(text).children.map(describeNode);
}

function readAcceptedFormulas(text: string): ReadonlyArray<string> {
  return splitEligibleReviewMathForSpeech(text)
    .filter((segment) => segment.kind === "formula")
    .map((segment) => segment.value);
}

function readOnlyParagraph(text: string): Extract<Nodes, { type: "paragraph" }> {
  const child = transformCardSide(text).children[0];
  if (child.type !== "paragraph") {
    throw new Error(`Expected a paragraph, received ${child.type}`);
  }

  return child;
}

describe("review math delimiter rules", () => {
  it("accepts a guarded inline span and a top-level display block", () => {
    expect(readAcceptedFormulas("Before $x$ after")).toEqual(["x"]);
    expect(readAcceptedFormulas("$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$"))
      .toEqual(["\\int_0^1 x^2\\,dx = \\frac{1}{3}"]);
    expect(readReviewMathOutline("$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$"))
      .toEqual(["display(\\int_0^1 x^2\\,dx = \\frac{1}{3})"]);
    expect(readAcceptedFormulas("$$E = mc^2$$")).toEqual(["E = mc^2"]);
  });

  it("keeps escaped, unbalanced, and code-covered dollars literal", () => {
    expect(readAcceptedFormulas("Price: \\$5")).toEqual([]);
    expect(readAcceptedFormulas("Unbalanced $x")).toEqual([]);
    expect(readReviewMathOutline("Unbalanced $x")).toEqual(["paragraph(Unbalanced $x)"]);
    expect(readAcceptedFormulas("`$inline_code$`")).toEqual([]);
    expect(readAcceptedFormulas("```text\n$fenced_code$\n```")).toEqual([]);
    expect(readReviewMathOutline("```text\n$fenced_code$\n```")).toEqual(["<code:$fenced_code$>"]);
    expect(readAcceptedFormulas("    $indented_code$")).toEqual([]);
    expect(readReviewMathOutline("    $indented_code$")).toEqual(["<code:$indented_code$>"]);
  });

  it("keeps a formula outside an inline code span ineligible in the same paragraph", () => {
    expect(readAcceptedFormulas("Before $x$ after `code`")).toEqual([]);
  });

  it("keeps math inside links, emphasis, lists, images, and containers literal", () => {
    expect(readAcceptedFormulas("[$link_label$](https://flashcards-open-source-app.com)")).toEqual([]);
    expect(readAcceptedFormulas("**$strong$**")).toEqual([]);
    expect(readAcceptedFormulas("- $list_item$")).toEqual([]);
    expect(readReviewMathOutline("- $list_item$")).toEqual(["<list:<listItem:paragraph($list_item$)>>"]);
    expect(readAcceptedFormulas("![Managed $label$](fcasset:media-asset-1)")).toEqual([]);
    expect(readReviewMathOutline("![Managed $label$](fcasset:media-asset-1)")).toEqual(["paragraph(<image>)"]);
    expect(readAcceptedFormulas("- Item:\n\n  $$\n  E = mc^2\n  $$")).toEqual([]);
  });

  it("performs no math segmentation on a side holding a reference definition", () => {
    const referenceSide = "Reference side with $x$ and [documentation][docs].\n\n"
      + "[docs]: https://flashcards-open-source-app.com";
    expect(readAcceptedFormulas(referenceSide)).toEqual([]);
    expect(readReviewMathOutline(referenceSide)).toEqual([
      "paragraph(Reference side with $x$ and <linkReference:documentation>.)",
      "<definition>",
    ]);
  });

  it("recognizes an invalid formula so the engine error stays visible", () => {
    expect(readAcceptedFormulas("Invalid $\\frac{1}{$")).toEqual(["\\frac{1}{"]);
    expect(readReviewMathOutline("Invalid $\\frac{1}{$")).toEqual(["paragraph(Invalid [\\frac{1}{])"]);
  });

  it("applies the pandoc opening, closing, and digit guards", () => {
    expect(readAcceptedFormulas("Earned value is $80,000 and actual cost is $100,000.")).toEqual([]);
    expect(readReviewMathOutline("Earned value is $80,000 and actual cost is $100,000."))
      .toEqual(["paragraph(Earned value is $80,000 and actual cost is $100,000.)"]);
    expect(readAcceptedFormulas("A $100 bond with yield $r$ pays")).toEqual(["r"]);
    expect(readAcceptedFormulas("Cost: $ x$")).toEqual([]);
    expect(readReviewMathOutline("Cost: $ x$")).toEqual(["paragraph(Cost: $ x$)"]);
    expect(readAcceptedFormulas("Prices are $20$30")).toEqual([]);
    expect(readReviewMathOutline("Prices are $20$30")).toEqual(["paragraph(Prices are $20$30)"]);
    expect(readAcceptedFormulas("where $m$ is mass and $c$ is the speed of light")).toEqual(["m", "c"]);
  });

  it("treats only the ASCII space and tab as space in the delimiter guards", () => {
    const nonBreakingSide = `Total is $${nonBreakingSpace}x${nonBreakingSpace}$ today.`;
    expect(readAcceptedFormulas(nonBreakingSide)).toEqual([`${nonBreakingSpace}x${nonBreakingSpace}`]);
    expect(readReviewMathOutline(nonBreakingSide))
      .toEqual([`paragraph(Total is [${nonBreakingSpace}x${nonBreakingSpace}] today.)`]);
  });

  it("never lets an inline span cross a line", () => {
    expect(readAcceptedFormulas("Mass is $m\nand energy is$E today.")).toEqual([]);
    expect(readReviewMathOutline("Mass is $m\nand energy is$E today."))
      .toEqual(["paragraph(Mass is $m\nand energy is$E today.)"]);
  });

  it("reads a run of two or more dollars as a display fence sequence, never as inline delimiters", () => {
    expect(readAcceptedFormulas("The formula $$E=mc^2$$ is famous.")).toEqual([]);
    expect(readReviewMathOutline("The formula $$E=mc^2$$ is famous."))
      .toEqual(["paragraph(The formula $$E=mc^2$$ is famous.)"]);
    expect(readAcceptedFormulas("$$E=mc^2$$ where $m$ is mass.")).toEqual(["m"]);
    expect(readAcceptedFormulas("Cost is $x and$$E$$ here$m$ ok.")).toEqual(["m"]);
  });

  it("requires the opening and closing display runs to hold the same number of dollars", () => {
    expect(readAcceptedFormulas("$$$x$$$")).toEqual(["x"]);
    expect(readReviewMathOutline("$$$x$$$")).toEqual(["display(x)"]);
    expect(readAcceptedFormulas("$$$x$$")).toEqual([]);
    expect(readReviewMathOutline("$$$x$$")).toEqual(["paragraph($$$x$$)"]);
    expect(readAcceptedFormulas("$$x$$$")).toEqual([]);
    expect(readReviewMathOutline("$$x$$$")).toEqual(["paragraph($$x$$$)"]);
    expect(readAcceptedFormulas("$$\nX\n$$$")).toEqual([]);
  });

  it("keeps a construct the parser cannot reproduce literal on every path", () => {
    // `remark-math` closes a text-math span on the escaped dollar, so the
    // construct the source rules accept has no node to render into. Rendering,
    // presentation selection, and speech all have to answer "no formula" here.
    const escapedDollarInlineSide = "The price $p = \\$5$ today.";
    expect(readAcceptedFormulas(escapedDollarInlineSide)).toEqual([]);
    expect(hasEligibleReviewMath(escapedDollarInlineSide)).toBe(false);
    expect(readReviewMathOutline(escapedDollarInlineSide))
      .toEqual(["paragraph(The price $p = \\$5$ today.)"]);

    const escapedDollarDisplaySide = "$$\\$x\\$$$";
    expect(readAcceptedFormulas(escapedDollarDisplaySide)).toEqual([]);
    expect(hasEligibleReviewMath(escapedDollarDisplaySide)).toBe(false);
    expect(readReviewMathOutline(escapedDollarDisplaySide)).toEqual(["paragraph($$$x$$$)"]);
  });

  it("requires a display construct to begin and end its own top-level block", () => {
    expect(readAcceptedFormulas("Answer:\n$$E = mc^2$$")).toEqual([]);
    expect(readAcceptedFormulas("Answer:\n$$\nE = mc^2\n$$")).toEqual([]);
    expect(readAcceptedFormulas("$$E = mc^2\n$$")).toEqual([]);
    expect(readAcceptedFormulas("$$E = mc^2$$\nAnswer text.")).toEqual([]);
    expect(readAcceptedFormulas("$$A$$\n$$B$$")).toEqual([]);
    expect(readAcceptedFormulas("$$E=mc^2$$ $$F=ma$$")).toEqual([]);
    expect(readAcceptedFormulas("$$\nA\n$$\n$$\nB\n$$")).toEqual(["A"]);
  });

  it("keeps an unterminated display fence literal", () => {
    expect(readAcceptedFormulas("$$\nE = mc^2\n\nThe **rest** of the side.")).toEqual([]);
  });

  it("exposes the formula source without delimiters and keeps literal dollars in speech prose", () => {
    expect(splitEligibleReviewMathForSpeech("A $100 bond with yield $r$ pays")).toEqual([
      { kind: "prose", startsAtLineBoundary: true, value: "A $100 bond with yield " },
      { kind: "formula", value: "r" },
      { kind: "prose", startsAtLineBoundary: false, value: " pays" },
    ]);
  });
});

describe("review math rendering", () => {
  it("keeps an accepted inline formula on the surrounding text baseline in its paragraph", () => {
    expect(readReviewMathOutline("Before $x$ after")).toEqual(["paragraph(Before [x] after)"]);
    expect(readReviewMathOutline("where $m$ is mass and $c$ is the speed of light"))
      .toEqual(["paragraph(where [m] is mass and [c] is the speed of light)"]);
  });

  it("renders an accepted inline formula as a review math span carrying its sources", () => {
    const paragraph = readOnlyParagraph("Before $x$ after");
    expect(paragraph.children.map((child) => child.type)).toEqual(["text", "inlineMath", "text"]);
    expect(paragraph.children[1].data).toEqual({
      hName: "span",
      hProperties: {
        className: ["review-math-inline"],
        "data-formula-source": "x",
        "data-delimited-source": "$x$",
      },
      hChildren: [],
    });
  });

  it("renders an accepted display formula as a standalone review math block", () => {
    const child = transformCardSide("$$E = mc^2$$").children[0];
    if (child.type !== "math") {
      throw new Error(`Expected a display formula, received ${child.type}`);
    }
    expect(child.value).toBe("E = mc^2");
    expect(child.data).toEqual({
      hName: "div",
      hProperties: {
        className: ["review-math-block"],
        "data-formula-source": "E = mc^2",
        "data-delimited-source": "$$E = mc^2$$",
      },
      hChildren: [],
    });
  });

  it("mixes literal dollars and an accepted formula inside one paragraph", () => {
    expect(readReviewMathOutline("A $100 bond with yield $r$ pays"))
      .toEqual(["paragraph(A $100 bond with yield [r] pays)"]);
    expect(readReviewMathOutline("$$E=mc^2$$ where $m$ is mass."))
      .toEqual(["paragraph($$E=mc^2$$ where [m] is mass.)"]);
    expect(readReviewMathOutline("Cost is $x and$$E$$ here$m$ ok."))
      .toEqual(["paragraph(Cost is $x and$$E$$ here[m] ok.)"]);
  });

  it("keeps a rejected display construct literal inside one paragraph", () => {
    expect(readReviewMathOutline("Answer:\n$$E = mc^2$$")).toEqual(["paragraph(Answer:\n$$E = mc^2$$)"]);
    expect(readReviewMathOutline("Answer:\n$$\nE = mc^2\n$$"))
      .toEqual(["paragraph(Answer:\n$$\nE = mc^2\n$$)"]);
    expect(readReviewMathOutline("$$E = mc^2\n$$")).toEqual(["paragraph($$E = mc^2\n$$)"]);
    expect(readReviewMathOutline("$$E = mc^2$$\nAnswer text."))
      .toEqual(["paragraph($$E = mc^2$$\nAnswer text.)"]);
    expect(readReviewMathOutline("$$A$$\n$$B$$")).toEqual(["paragraph($$A$$\n$$B$$)"]);
    expect(readReviewMathOutline("$$E=mc^2$$ $$F=ma$$")).toEqual(["paragraph($$E=mc^2$$ $$F=ma$$)"]);
    expect(readReviewMathOutline("$$\nX\n$$$")).toEqual(["paragraph($$\nX\n$$$)"]);
  });

  it("needs a blank line between two multiple-line display constructs", () => {
    expect(readReviewMathOutline("$$\nA\n$$\n$$\nB\n$$")).toEqual(["display(A)", "paragraph($$\nB\n$$)"]);
  });

  it("returns the remainder of an unterminated display fence to ordinary Markdown", () => {
    expect(readReviewMathOutline("$$\nE = mc^2\n\nThe **rest** of the side."))
      .toEqual(["paragraph($$\nE = mc^2)", "paragraph(The <strong:rest> of the side.)"]);
  });

  it("keeps dollar-delimited source literal wherever math is ineligible", () => {
    expect(readReviewMathOutline("`$inline_code$`")).toEqual(["paragraph(<inlineCode:$inline_code$>)"]);
    expect(readReviewMathOutline("Before $x$ after `code`"))
      .toEqual(["paragraph(Before $x$ after <inlineCode:code>)"]);
    expect(readReviewMathOutline("[$link_label$](https://flashcards-open-source-app.com)"))
      .toEqual(["paragraph(<link:$link_label$>)"]);
    expect(readReviewMathOutline("**$strong$**")).toEqual(["paragraph(<strong:$strong$>)"]);
    expect(readReviewMathOutline("Price: \\$5")).toEqual(["paragraph(Price: $5)"]);
  });

  it("keeps display math inside a container block literal", () => {
    const outline = readReviewMathOutline("- Item:\n\n  $$\n  E = mc^2\n  $$").join("");
    expect(outline).toContain("$$\nE = mc^2\n$$");
    expect(outline).not.toContain("display(");
  });
});
