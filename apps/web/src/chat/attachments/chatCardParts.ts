import type { Card, ContentPart } from "../../types";

export type ChatCardSnapshot = Readonly<{
  cardId: string;
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
}>;

export type CardPendingAttachment = Readonly<{
  type: "card";
  attachmentId: string;
  cardId: string;
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
}>;

export function toChatCardSnapshot(card: Card): ChatCardSnapshot {
  return {
    cardId: card.cardId,
    frontText: card.frontText,
    backText: card.backText,
    tags: card.tags,
  };
}

export function makeCardPendingAttachment(card: ChatCardSnapshot): CardPendingAttachment {
  return {
    type: "card",
    attachmentId: crypto.randomUUID(),
    cardId: card.cardId,
    frontText: card.frontText,
    backText: card.backText,
    tags: card.tags,
  };
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildCardContextXml(card: ChatCardSnapshot): string {
  const tagsXml = card.tags.map((tag) => `<tag>${escapeXmlText(tag)}</tag>`).join("");

  return [
    "<attached_card>",
    `<card_id>${escapeXmlText(card.cardId)}</card_id>`,
    "<front_text>",
    escapeXmlText(card.frontText),
    "</front_text>",
    "<back_text>",
    escapeXmlText(card.backText),
    "</back_text>",
    `<tags>${tagsXml}</tags>`,
    "</attached_card>",
  ].join("\n");
}

export function formatCardAttachmentLabel(card: ChatCardSnapshot): string {
  const trimmedFrontText = card.frontText.trim();
  if (trimmedFrontText.length <= 48) {
    return trimmedFrontText === "" ? "Untitled card" : trimmedFrontText;
  }

  return `${trimmedFrontText.slice(0, 48)}…`;
}

export function isCardContentPart(part: ContentPart): part is Extract<ContentPart, { type: "card" }> {
  return part.type === "card";
}
