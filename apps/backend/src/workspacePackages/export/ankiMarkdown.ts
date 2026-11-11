import MarkdownIt from "markdown-it";
import { addAnkiMathRules } from "./ankiMath";

export type AnkiMedia = Readonly<{
  filename: string;
  kind: "image" | "playable" | "attachment";
}>;

function escapeAnkiDirectives(html: string): string {
  return html.replace(/\[(?=sound:|anki:|latex\]|\$\$?\]|\[type:)/giu, "&#91;");
}

function renderManagedMedia(media: AnkiMedia, label: string): string {
  if (media.kind === "image") {
    return '<img src="' + media.filename + '" alt="' + label + '">';
  }
  if (media.kind === "playable") {
    return '[sound:' + media.filename + ']';
  }
  return '<a href="' + media.filename + '" download>' + (label || media.filename) + '</a>';
}

export function createAnkiMarkdownRenderer(mediaByPath: ReadonlyMap<string, AnkiMedia>): (source: string) => string {
  const markdown = new MarkdownIt({ html: false, breaks: true });
  markdown.validateLink = (url) => /^(?:https?:\/\/|mailto:|#)/iu.test(url) || mediaByPath.has(url);
  const escapeText = (text: string): string => escapeAnkiDirectives(markdown.utils.escapeHtml(text));

  addAnkiMathRules(markdown, escapeText);

  const renderAttrs = markdown.renderer.renderAttrs.bind(markdown.renderer);
  markdown.renderer.renderAttrs = (token) => escapeAnkiDirectives(renderAttrs(token));

  for (const name of ["text", "code_inline", "code_block", "fence"]) {
    const render = markdown.renderer.rules[name];
    markdown.renderer.rules[name] = (...args) => escapeAnkiDirectives(render(...args));
  }

  const renderImage = markdown.renderer.rules.image;
  markdown.renderer.rules.image = (tokens, index, options, env, renderer) => {
    const token = tokens[index];
    const src = String(token.attrGet("src") ?? "");
    const media = mediaByPath.get(src);
    if (media === undefined && /^https?:\/\//iu.test(src)) {
      return renderImage(tokens, index, options, env, renderer);
    }

    const label = escapeText(renderer.renderInlineAsText(token.children ?? [], options, env));
    if (media === undefined) {
      return label;
    }
    const attachment = renderManagedMedia(media, label);
    return media.kind === "playable" && label !== "" ? label + " " + attachment : attachment;
  };

  markdown.core.ruler.push("anki_managed_media_links", (state) => {
    for (const block of state.tokens) {
      let media: AnkiMedia | undefined;
      for (const token of block.children ?? []) {
        if (token.type === "link_open") {
          media = mediaByPath.get(String(token.attrGet("href") ?? ""));
          if (media?.kind === "attachment") {
            token.attrSet("href", media.filename);
            token.attrSet("download", "");
          } else if (media !== undefined) {
            token.tag = "span";
            token.attrs = null;
          }
        } else if (token.type === "link_close" && media !== undefined && media.kind !== "attachment") {
          token.type = "anki_managed_media_close";
          token.content = renderManagedMedia(media, "");
        }
      }
    }
  });
  markdown.renderer.rules.anki_managed_media_close = (tokens, index) => "</span> " + tokens[index].content;

  return (source) => {
    const html = markdown.render(source).trim().replaceAll("\u001f", "&#31;");
    if (html === html.normalize("NFC")) {
      return html;
    }

    // Anki normalizes fields on import, so encode graphemes whose code points would change.
    const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" }).segment(html);
    return Array.from(graphemes, ({ segment }) => (
      segment === segment.normalize("NFC")
        ? segment
        : segment.replace(/[^\u0000-\u007f]/gu, (character) => "&#" + character.codePointAt(0) + ";")
    )).join("");
  };
}
