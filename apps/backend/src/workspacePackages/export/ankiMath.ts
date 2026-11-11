import type MarkdownIt from "markdown-it";

function isEscaped(source: string, position: number): boolean {
  let before = position - 1;
  while (source[before] === "\\") {
    before -= 1;
  }
  return (position - before) % 2 === 0;
}

function isInlineCodeOrLink({ type }: MarkdownIt.Token): boolean {
  return type === "code_inline" || type === "link_open" || type === "image";
}

function parseInlineMath(state: MarkdownIt.StateInline, silent: boolean): boolean {
  const start = state.pos;
  const { src, posMax } = state;
  if (silent || src[start] !== "$" || start + 1 === posMax || /[ \t\n$]/u.test(src[start + 1])) {
    return false;
  }
  if (src[start - 1] === "$" && !isEscaped(src, start - 1)) {
    return false;
  }

  for (let end = start + 1; end < posMax; end += 1) {
    const char = src[end];
    if (char === "\n") {
      return false;
    }
    if (char !== "$" || isEscaped(src, end)) {
      continue;
    }
    if (/[ \t]/u.test(src[end - 1]) || /[0-9$]/u.test(src[end + 1] ?? "")) {
      return false;
    }

    const token = state.push("anki_math_inline", "", 0);
    token.content = src.slice(start + 1, end);
    state.pos = end + 1;
    return true;
  }
  return false;
}

function parseDisplayMath(
  state: MarkdownIt.StateBlock,
  start: number,
  end: number,
  silent: boolean,
): boolean {
  if (silent || state.env?.disableAnkiMath === true || state.parentType !== "root"
    || state.sCount[start] > 3 || (start > 0 && !state.isEmpty(start - 1))) {
    return false;
  }

  const lineText = (line: number): string => state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
  const match = /^(\${2,})(.*)$/u.exec(lineText(start));
  if (match === null) {
    return false;
  }

  const [, delimiter, rest] = match;
  let content: string;
  let endLine: number;
  if (/^[ \t]*$/u.test(rest)) {
    let closingLine = start + 1;
    const codeLines = state.env.ankiCodeLines;
    while (closingLine < end) {
      if (codeLines instanceof Set && codeLines.has(closingLine)) {
        return false;
      }
      if (state.sCount[closingLine] <= 3 && /^[$]{2,}[ \t]*$/u.test(lineText(closingLine))) {
        break;
      }
      closingLine += 1;
    }
    if (closingLine === end || lineText(closingLine).trimEnd() !== delimiter) {
      return false;
    }
    content = state.src.slice(state.bMarks[start + 1], state.bMarks[closingLine]).replace(/\n$/u, "");
    endLine = closingLine + 1;
  } else {
    let close = rest.indexOf("$");
    while (close !== -1 && isEscaped(rest, close)) {
      close = rest.indexOf("$", close + 1);
    }
    if (close <= 0 || !rest.startsWith(delimiter, close)
      || !/^[ \t]*$/u.test(rest.slice(close + delimiter.length))
      || (start + 1 < end && !state.isEmpty(start + 1))) {
      return false;
    }
    content = rest.slice(0, close);
    endLine = start + 1;
  }

  if (/[<\[`]/u.test(content)) {
    const children: MarkdownIt.Token[] = [];
    state.md.inline.parse(content, state.md, {}, children);
    if (children.some(isInlineCodeOrLink)) {
      return false;
    }
  }

  const token = state.push("anki_math_display", "", 0);
  token.content = content;
  token.map = [start, endLine];
  state.line = endLine;
  return true;
}

export function addAnkiMathRules(markdown: MarkdownIt.MarkdownIt, escapeText: (text: string) => string): void {
  markdown.core.ruler.before("block", "anki_math_block_context", (state) => {
    if (!/^ {0,3}[$]{2,}/mu.test(state.src)) {
      return;
    }

    const plainEnv: MarkdownIt.Env = { disableAnkiMath: true };
    const plainTokens: MarkdownIt.Token[] = [];
    markdown.block.parse(state.src, markdown, plainEnv, plainTokens);
    if (Object.keys(plainEnv.references ?? {}).length !== 0) {
      state.env.disableAnkiMath = true;
      return;
    }

    const codeLines = new Set<number>();
    for (const { type, map } of plainTokens) {
      if ((type === "fence" || type === "code_block") && map !== null) {
        for (let line = map[0]; line < map[1]; line += 1) {
          codeLines.add(line);
        }
      }
    }
    state.env.ankiCodeLines = codeLines;
  });
  markdown.block.ruler.before("paragraph", "anki_math_display", parseDisplayMath);
  markdown.inline.ruler.before("text", "anki_math_inline", (state, silent) => (
    state.env?.allowAnkiInlineMath === true && parseInlineMath(state, silent)
  ));
  markdown.core.ruler.at("inline", (state) => {
    const env = state.env;
    const allowMath = env.disableAnkiMath !== true && Object.keys(env.references ?? {}).length === 0;
    for (const [index, token] of state.tokens.entries()) {
      if (token.type !== "inline") {
        continue;
      }

      const children: MarkdownIt.Token[] = [];
      markdown.inline.parse(token.content, markdown, env, children);
      token.children = children;

      const previous = state.tokens[index - 1];
      if (!allowMath || previous?.type !== "paragraph_open" || previous.level !== 0
        || !token.content.includes("$") || children.some(isInlineCodeOrLink)) {
        continue;
      }

      const mathChildren: MarkdownIt.Token[] = [];
      markdown.inline.parse(token.content, markdown, { ...env, allowAnkiInlineMath: true }, mathChildren);
      if (mathChildren.every(({ type }) => ["text", "text_special", "softbreak", "anki_math_inline"].includes(type))) {
        token.children = mathChildren;
      }
    }
  });
  markdown.renderer.rules.anki_math_inline = (tokens, index) => "\\(" + escapeText(tokens[index].content) + "\\)";
  markdown.renderer.rules.anki_math_display = (tokens, index) => "<div>\\[" + escapeText(tokens[index].content) + "\\]</div>\n";
}
