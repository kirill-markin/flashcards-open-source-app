import type { ReactElement } from "react";
import type { TranslationKey } from "../i18n";
import type { TranslationValues } from "../i18n/types";
import type { StoredMessage } from "./useChatHistory";
import { buildCardContextXml, formatCardAttachmentLabel } from "./chatCardParts";

type Translate = (key: TranslationKey, values?: TranslationValues) => string;

function formatEffortValue(value: "fast" | "medium" | "long", t: Translate): string {
  if (value === "fast") {
    return t("effortLevels.fast");
  }

  if (value === "medium") {
    return t("effortLevels.medium");
  }

  return t("effortLevels.long");
}

/**
 * Maps machine-oriented tool names into short user-facing labels while keeping
 * unsupported or future tool names visible instead of dropping them.
 *
 * Mirrors:
 * - `apps/ios/Flashcards/Flashcards/AI/AIChatToolPresentation.swift::aiChatToolLabel`
 * - `apps/android/feature/ai/src/main/java/com/flashcardsopensourceapp/feature/ai/AiToolCallPresentation.kt::formatAiToolLabel`
 */
export function formatToolLabel(name: string, t: Translate): string {
  if (name === "sql") return t("chatMessageContent.toolLabels.sql");
  if (name === "code_execution" || name === "code_interpreter") return t("chatMessageContent.toolLabels.codeExecution");
  if (name === "web_search") return t("chatMessageContent.toolLabels.webSearch");
  return name;
}

/**
 * Mirrors:
 * - `apps/ios/Flashcards/Flashcards/AI/AIChatToolPresentation.swift::aiChatToolPreview`
 * - `apps/android/feature/ai/src/main/java/com/flashcardsopensourceapp/feature/ai/AiToolCallPresentation.kt::formatAiToolCallPreview`
 */
function extractToolCallPreview(name: string, input: string | null): string | null {
  if (input === null || input.trim() === "") {
    return null;
  }

  if (name !== "sql") {
    return input;
  }

  try {
    const parsed = JSON.parse(input) as Readonly<{ sql?: unknown }>;
    if (typeof parsed.sql === "string" && parsed.sql.trim() !== "") {
      return parsed.sql;
    }
  } catch {
    return input;
  }

  return input;
}

function toolCallStatusLabel(status: "started" | "completed", t: Translate): string {
  return status === "started" ? t("chatMessageContent.statuses.started") : t("chatMessageContent.statuses.completed");
}

function reasoningStatusLabel(status: "started" | "completed" | undefined, t: Translate): string {
  return status === "started" ? t("chatMessageContent.statuses.started") : t("chatMessageContent.statuses.completed");
}

function buildToolCallSummaryText(name: string, input: string | null, t: Translate): string {
  const toolLabel = formatToolLabel(name, t);
  const toolPreview = extractToolCallPreview(name, input);
  return toolPreview === null ? toolLabel : `${toolLabel}: ${toolPreview}`;
}

function toClipboardErrorMessage(sectionTitle: string, error: unknown, t: Translate): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return `${t("chatMessageContent.failedToCopy", { section: sectionTitle.toLowerCase() })} ${error.message}`;
  }

  return t("chatMessageContent.failedToCopy", { section: sectionTitle.toLowerCase() });
}

async function copyToolCallSection(text: string, sectionTitle: string, t: Translate): Promise<void> {
  if (typeof navigator.clipboard?.writeText !== "function") {
    window.alert(t("chatMessageContent.failedToCopy", { section: sectionTitle.toLowerCase() }));
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    window.alert(toClipboardErrorMessage(sectionTitle, error, t));
  }
}

function renderToolCallSection(
  sectionTitle: string,
  text: string | null,
  sectionClassName: "input" | "output",
  t: Translate,
): ReactElement | null {
  if (text === null || text === "") {
    return null;
  }

  return (
    <section className={`chat-tool-call-section chat-tool-call-section-${sectionClassName}`}>
      <div className="chat-tool-call-section-header">
        <span className="chat-tool-call-section-title">{sectionTitle}</span>
        <button
          type="button"
          className="chat-tool-call-copy"
          onClick={() => {
            void copyToolCallSection(text, sectionTitle, t);
          }}
        >
          {t("chatMessageContent.copy")}
        </button>
      </div>
      <pre className={`chat-tool-call-${sectionClassName}`}>{text}</pre>
    </section>
  );
}

function renderCardAttachment(
  card: Readonly<{
    cardId: string;
    frontText: string;
    backText: string;
    tags: ReadonlyArray<string>;
    effortLevel: "fast" | "medium" | "long";
  }>,
  key: string,
  t: Translate,
): ReactElement {
  return (
    <details key={key} className="chat-card-part">
      <summary className="chat-card-part-summary">
        <span className="chat-card-part-label">{t("chatMessageContent.card")}</span>
        <span className="chat-card-part-title" title={card.frontText}>
          {formatCardAttachmentLabel(card)}
        </span>
      </summary>
      <div className="chat-card-part-body">
        <div className="chat-card-part-meta">
          <span>{t("chatMessageContent.id", { value: card.cardId })}</span>
          <span>{t("chatMessageContent.toolMeta.effort", { value: formatEffortValue(card.effortLevel, t) })}</span>
          <span>{card.tags.length === 0 ? t("chatMessageContent.noTags") : card.tags.join(", ")}</span>
        </div>
        <details className="chat-card-part-context">
          <summary className="chat-card-part-context-summary">{t("chatMessageContent.promptContext")}</summary>
          <pre className="chat-card-part-xml">{buildCardContextXml(card)}</pre>
        </details>
      </div>
    </details>
  );
}

/**
 * Renders persisted chat history parts without normalizing whitespace so the
 * transcript stays byte-for-byte faithful to stored assistant output.
 */
export function renderStoredMessageContent(message: StoredMessage, t: Translate): ReactElement {
  const elements: Array<ReactElement> = [];
  let previousPartWasAttachment = false;

  for (let index = 0; index < message.content.length; index += 1) {
    const part = message.content[index];
    if (part.type === "text") {
      if (previousPartWasAttachment) {
        elements.push(<br key={`attachment-break-1-${index}`} />);
        elements.push(<br key={`attachment-break-2-${index}`} />);
      }
      elements.push(<span key={`text-${index}`}>{part.text}</span>);
      previousPartWasAttachment = false;
      continue;
    }

    if (part.type === "image") {
      elements.push(<span key={`image-${index}`}>{t("chatMessageContent.imageAttached")}</span>);
      previousPartWasAttachment = true;
      continue;
    }

    if (part.type === "file") {
      elements.push(<span key={`file-${index}`}>[{part.fileName}]</span>);
      previousPartWasAttachment = true;
      continue;
    }

    if (part.type === "card") {
      elements.push(renderCardAttachment(part, `card-${index}`, t));
      previousPartWasAttachment = true;
      continue;
    }

    if (part.type === "reasoning_summary") {
      const reasoningStatus = part.status ?? "completed";
      const reasoningText = part.summary === "" ? t("chatMessageContent.thinking") : part.summary;
      elements.push(
        <details key={`reasoning-${index}`} className={`chat-tool-call chat-tool-call-${reasoningStatus}`}>
          <summary className="chat-tool-call-summary">
            <span className="chat-tool-call-summary-main" title={reasoningText}>{t("chatMessageContent.reasoning")}</span>
            <span className="chat-tool-call-status">{reasoningStatusLabel(part.status, t)}</span>
          </summary>
          <pre className="chat-tool-call-output">{reasoningText}</pre>
        </details>,
      );
      previousPartWasAttachment = false;
      continue;
    }

    previousPartWasAttachment = false;
    const summaryText = buildToolCallSummaryText(part.name, part.input, t);
    elements.push(
      <details
        key={`tool-${index}`}
        className={`chat-tool-call chat-tool-call-${part.status}`}
      >
        <summary className="chat-tool-call-summary">
          <span className="chat-tool-call-summary-main" title={summaryText}>{summaryText}</span>
          <span className="chat-tool-call-status">{toolCallStatusLabel(part.status, t)}</span>
        </summary>
        {renderToolCallSection(t("chatMessageContent.request"), part.input, "input", t)}
        {renderToolCallSection(t("chatMessageContent.response"), part.output, "output", t)}
      </details>,
    );
  }

  return <>{elements}</>;
}
