import type { CardContentPart } from "./types";

function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function buildTagXml(tag: string): string {
  return `<tag>${escapeXmlText(tag)}</tag>`;
}

export function buildCardContextXml(part: CardContentPart): string {
  const tagsXml = part.tags.map(buildTagXml).join("");

  return [
    "<attached_card>",
    `<card_id>${escapeXmlText(part.cardId)}</card_id>`,
    `<effort_level>${escapeXmlText(part.effortLevel)}</effort_level>`,
    "<front_text>",
    escapeXmlText(part.frontText),
    "</front_text>",
    "<back_text>",
    escapeXmlText(part.backText),
    "</back_text>",
    `<tags>${tagsXml}</tags>`,
    "</attached_card>",
  ].join("\n");
}
