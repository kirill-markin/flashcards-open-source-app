import type { ReactElement } from "react";
import type { StoredMessage } from "./useChatHistory";
import { buildCardContextXml, formatCardAttachmentLabel } from "./chatCardParts";

/**
 * Maps machine-oriented tool names into short user-facing labels while keeping
 * unsupported or future tool names visible instead of dropping them.
 *
 * Mirrors:
 * - `apps/ios/Flashcards/Flashcards/AI/AIChatToolPresentation.swift::aiChatToolLabel`
 * - `apps/android/feature/ai/src/main/java/com/flashcardsopensourceapp/feature/ai/AiToolCallPresentation.kt::formatAiToolLabel`
 */
export function formatToolLabel(name: string): string {
  if (name === "sql") return "SQL";
  if (name === "code_execution" || name === "code_interpreter") return "Code execution";
  if (name === "web_search") return "Web search";
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

function toolCallStatusLabel(status: "started" | "completed"): string {
  return status === "started" ? "Running" : "Done";
}

function reasoningStatusLabel(status: "started" | "completed" | undefined): string {
  return status === "started" ? "Running" : "Done";
}

function buildToolCallSummaryText(name: string, input: string | null): string {
  const toolLabel = formatToolLabel(name);
  const toolPreview = extractToolCallPreview(name, input);
  return toolPreview === null ? toolLabel : `${toolLabel}: ${toolPreview}`;
}

function toClipboardErrorMessage(sectionTitle: string, error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return `Failed to copy ${sectionTitle.toLowerCase()}. ${error.message}`;
  }

  return `Failed to copy ${sectionTitle.toLowerCase()}.`;
}

async function copyToolCallSection(text: string, sectionTitle: string): Promise<void> {
  if (typeof navigator.clipboard?.writeText !== "function") {
    window.alert(`Failed to copy ${sectionTitle.toLowerCase()}. Clipboard API is unavailable.`);
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    window.alert(toClipboardErrorMessage(sectionTitle, error));
  }
}

function renderToolCallSection(
  sectionTitle: string,
  text: string | null,
  sectionClassName: "input" | "output",
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
            void copyToolCallSection(text, sectionTitle);
          }}
        >
          Copy
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
): ReactElement {
  return (
    <details key={key} className="chat-card-part">
      <summary className="chat-card-part-summary">
        <span className="chat-card-part-label">Card</span>
        <span className="chat-card-part-title" title={card.frontText}>
          {formatCardAttachmentLabel(card)}
        </span>
      </summary>
      <div className="chat-card-part-body">
        <div className="chat-card-part-meta">
          <span>ID {card.cardId}</span>
          <span>Effort {card.effortLevel}</span>
          <span>{card.tags.length === 0 ? "No tags" : card.tags.join(", ")}</span>
        </div>
        <details className="chat-card-part-context">
          <summary className="chat-card-part-context-summary">Prompt context</summary>
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
export function renderStoredMessageContent(message: StoredMessage): ReactElement {
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
      elements.push(<span key={`image-${index}`}>[image attached]</span>);
      previousPartWasAttachment = true;
      continue;
    }

    if (part.type === "file") {
      elements.push(<span key={`file-${index}`}>[{part.fileName}]</span>);
      previousPartWasAttachment = true;
      continue;
    }

    if (part.type === "card") {
      elements.push(renderCardAttachment(part, `card-${index}`));
      previousPartWasAttachment = true;
      continue;
    }

    if (part.type === "reasoning_summary") {
      const reasoningStatus = part.status ?? "completed";
      const reasoningText = part.summary === "" ? "Thinking..." : part.summary;
      elements.push(
        <details key={`reasoning-${index}`} className={`chat-tool-call chat-tool-call-${reasoningStatus}`}>
          <summary className="chat-tool-call-summary">
            <span className="chat-tool-call-summary-main" title={reasoningText}>Reasoning</span>
            <span className="chat-tool-call-status">{reasoningStatusLabel(part.status)}</span>
          </summary>
          <pre className="chat-tool-call-output">{reasoningText}</pre>
        </details>,
      );
      previousPartWasAttachment = false;
      continue;
    }

    previousPartWasAttachment = false;
    const summaryText = buildToolCallSummaryText(part.name, part.input);
    elements.push(
      <details
        key={`tool-${index}`}
        className={`chat-tool-call chat-tool-call-${part.status}`}
      >
        <summary className="chat-tool-call-summary">
          <span className="chat-tool-call-summary-main" title={summaryText}>{summaryText}</span>
          <span className="chat-tool-call-status">{toolCallStatusLabel(part.status)}</span>
        </summary>
        {renderToolCallSection("Request", part.input, "input")}
        {renderToolCallSection("Response", part.output, "output")}
      </details>,
    );
  }

  return <>{elements}</>;
}
