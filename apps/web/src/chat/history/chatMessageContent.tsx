import { useState, type ReactElement } from "react";
import { isExpectedClipboardWriteError } from "../../access/browserAccess";
import type { TranslationKey } from "../../i18n";
import type { TranslationValues } from "../../i18n/types";
import type { StoredMessage } from "./useChatHistory";
import { ContentText } from "../../components/ContentText";
import { MathText } from "../../components/MathText";
import { hasEligibleReviewMath } from "../../screens/review/components/card/reviewMathBlocks";
import { buildCardContextXml, formatCardAttachmentLabel } from "../attachments/chatCardParts";
import { localizeChatTerminalError } from "../shared/chatTerminalErrorPolicy";
import { ChatWorkBlock, findLastWorkPartIndex, isWorkBlockAutoOpen } from "./ChatWorkBlock";

type Translate = (key: TranslationKey, values?: TranslationValues) => string;
type ChatMessageTechnicalErrorHandler = (error: unknown) => boolean;

/**
 * Maps machine-oriented tool names into short user-facing labels while keeping
 * unsupported or future tool names visible instead of dropping them.
 *
 * Mirrors:
 * - `apps/ios/Flashcards/Flashcards/AI/Views/Transcript/AIChatToolPresentation.swift::aiChatToolLabel`
 * - `apps/android/feature/ai/src/main/java/com/flashcardsopensourceapp/feature/ai/toolcall/AiToolCallPresentation.kt::formatAiToolLabel`
 */
export function formatToolLabel(name: string, t: Translate): string {
  if (name === "sql") return t("chatMessageContent.toolLabels.sql");
  if (name === "sql_query") return t("chatMessageContent.toolLabels.sqlQuery");
  if (name === "sql_execute") return t("chatMessageContent.toolLabels.sqlExecute");
  if (name === "list_workspaces") return t("chatMessageContent.toolLabels.listWorkspaces");
  if (name === "get_guide") return t("chatMessageContent.toolLabels.getGuide");
  if (name === "next_review_card") return t("chatMessageContent.toolLabels.nextReviewCard");
  if (name === "reveal_answer") return t("chatMessageContent.toolLabels.revealAnswer");
  if (name === "submit_review") return t("chatMessageContent.toolLabels.submitReview");
  if (name === "code_execution" || name === "code_interpreter") return t("chatMessageContent.toolLabels.codeExecution");
  if (name === "add_generated_image_to_card") return t("chatMessageContent.toolLabels.generatedCardImage");
  if (name === "web_search") return t("chatMessageContent.toolLabels.webSearch");
  return name;
}

/**
 * The SQL tools all take their statement in the same JSON `sql` field, so the
 * transcript previews the statement itself instead of the raw JSON envelope.
 */
function isSqlToolName(name: string): boolean {
  return name === "sql" || name === "sql_query" || name === "sql_execute";
}

/**
 * Mirrors:
 * - `apps/ios/Flashcards/Flashcards/AI/Views/Transcript/AIChatToolPresentation.swift::aiChatToolPreview`
 * - `apps/android/feature/ai/src/main/java/com/flashcardsopensourceapp/feature/ai/toolcall/AiToolCallPresentation.kt::formatAiToolCallPreview`
 */
function extractToolCallPreview(name: string, input: string | null): string | null {
  if (name === "add_generated_image_to_card") {
    return null;
  }

  if (input === null || input.trim() === "") {
    return null;
  }

  if (isSqlToolName(name) === false) {
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

/**
 * Only a running row carries a status; a finished row stays a quiet one-line summary.
 */
function renderRunningStatus(status: "started" | "completed", t: Translate): ReactElement | null {
  if (status === "completed") {
    return null;
  }

  return <span className="chat-tool-call-status">{t("chatMessageContent.statuses.started")}</span>;
}

function buildToolCallSummaryText(name: string, input: string | null, t: Translate): string {
  const toolLabel = formatToolLabel(name, t);
  const toolPreview = extractToolCallPreview(name, input);
  return toolPreview === null ? toolLabel : `${toolLabel}: ${toolPreview}`;
}

function toClipboardErrorMessage(sectionTitle: string, t: Translate): string {
  return t("chatMessageContent.failedToCopy", { section: sectionTitle.toLowerCase() });
}

async function copyToolCallSection(
  text: string,
  sectionTitle: string,
  t: Translate,
  onTechnicalError: ChatMessageTechnicalErrorHandler,
  canStartAction: () => boolean,
): Promise<boolean> {
  if (canStartAction() === false) {
    return false;
  }

  if (typeof navigator.clipboard?.writeText !== "function") {
    window.alert(t("chatMessageContent.failedToCopy", { section: sectionTitle.toLowerCase() }));
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    if (canStartAction() === false) {
      return false;
    }

    if (isExpectedClipboardWriteError(error)) {
      window.alert(toClipboardErrorMessage(sectionTitle, t));
      return false;
    }

    if (onTechnicalError(error) === false) {
      window.alert(toClipboardErrorMessage(sectionTitle, t));
    }
    return false;
  }
}

function ChatMathCopyButton(props: Readonly<{
  text: string;
  hasRenderedMath?: boolean;
  sectionTitle: string;
  t: Translate;
  onTechnicalError: ChatMessageTechnicalErrorHandler;
  canStartAction: () => boolean;
}>): ReactElement | null {
  const { text, hasRenderedMath, sectionTitle, t, onTechnicalError, canStartAction } = props;
  const [status, setStatus] = useState<"idle" | "copying" | "copied">("idle");
  if ((hasRenderedMath ?? (text.includes("$") && hasEligibleReviewMath(text))) === false) {
    return null;
  }

  return (
    <div className="chat-message-copy">
      <button
        type="button"
        className="chat-tool-call-copy"
        disabled={status === "copying" || canStartAction() === false}
        aria-busy={status === "copying"}
        data-testid="chat-math-copy"
        onClick={() => {
          setStatus("copying");
          void copyToolCallSection(text, sectionTitle, t, onTechnicalError, canStartAction)
            .then((copied) => setStatus(copied ? "copied" : "idle"));
        }}
      >
        {t("chatMessageContent.copy")}
      </button>
      <span role="status" aria-live="polite">
        {status === "copying" ? t("chatMessageContent.copying")
          : status === "copied" ? t("chatMessageContent.copied") : ""}
      </span>
    </div>
  );
}

function renderToolCallSection(
  sectionTitle: string,
  text: string | null,
  sectionClassName: "input" | "output",
  t: Translate,
  onTechnicalError: ChatMessageTechnicalErrorHandler,
  canStartAction: () => boolean,
): ReactElement | null {
  if (text === null || text === "") {
    return null;
  }

  return (
    <section
      className={`chat-tool-call-section chat-tool-call-section-${sectionClassName}`}
      data-tool-call-section={sectionClassName}
    >
      <div className="chat-tool-call-section-header">
        <span className="chat-tool-call-section-title">{sectionTitle}</span>
        <button
          type="button"
          className="chat-tool-call-copy"
          onClick={() => {
            void copyToolCallSection(text, sectionTitle, t, onTechnicalError, canStartAction);
          }}
          disabled={canStartAction() === false}
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
  }>,
  key: string,
  t: Translate,
): ReactElement {
  return (
    <details key={key} className="chat-card-part">
      <summary className="chat-card-part-summary">
        <span className="chat-card-part-label">{t("chatMessageContent.card")}</span>
        <span className="chat-card-part-title" title={card.frontText}>
          <MathText text={formatCardAttachmentLabel(card)} />
        </span>
      </summary>
      <div className="chat-card-part-body">
        <div className="chat-card-part-meta">
          <span>{t("chatMessageContent.id", { value: card.cardId })}</span>
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

type MessageRenderContext = Readonly<{ workspaceId: string | null; localReadVersion: number }>;

/**
 * Renders `message.content[startIndex..endIndex)`; keys use absolute part indexes.
 */
function renderContentPartRange(
  message: StoredMessage,
  startIndex: number,
  endIndex: number,
  t: Translate,
  onTechnicalError: ChatMessageTechnicalErrorHandler,
  canStartAction: () => boolean,
  renderContext: MessageRenderContext,
): Array<ReactElement> {
  const elements: Array<ReactElement> = [];
  let previousPartNeedsTextSeparator = false;

  for (let index = startIndex; index < endIndex; index += 1) {
    const part = message.content[index];
    if (part.type === "text") {
      if (previousPartNeedsTextSeparator) {
        elements.push(<br key={`attachment-break-1-${index}`} />);
        elements.push(<br key={`attachment-break-2-${index}`} />);
      }
      elements.push(<ContentText key={`text-${index}`} text={localizeChatTerminalError(message.errorCode, part.text, t)} {...renderContext} />);
      previousPartNeedsTextSeparator = false;
      continue;
    }

    if (part.type === "image") {
      elements.push(<span key={`image-${index}`}>{t("chatMessageContent.imageAttached")}</span>);
      previousPartNeedsTextSeparator = true;
      continue;
    }

    if (part.type === "file") {
      elements.push(<span key={`file-${index}`}>[{part.fileName}]</span>);
      previousPartNeedsTextSeparator = true;
      continue;
    }

    if (part.type === "card") {
      elements.push(renderCardAttachment(part, `card-${index}`, t));
      previousPartNeedsTextSeparator = false;
      continue;
    }

    if (part.type === "reasoning_summary") {
      const reasoningStatus = part.status ?? "completed";
      const reasoningText = part.summary === "" ? t("chatMessageContent.thinking") : part.summary;
      elements.push(
        <details
          key={`reasoning-${index}`}
          className={`chat-tool-call chat-tool-call-${reasoningStatus}`}
          data-testid="chat-tool-call"
          data-tool-call-kind="reasoning"
          data-tool-call-status={reasoningStatus}
        >
          <summary className="chat-tool-call-summary">
            <span className="chat-tool-call-summary-main" title={reasoningText}>{t("chatMessageContent.reasoning")}</span>
            {renderRunningStatus(reasoningStatus, t)}
          </summary>
          <div className="chat-tool-call-output"><ContentText text={reasoningText} {...renderContext} /></div>
          <ChatMathCopyButton text={reasoningText} sectionTitle={t("chatMessageContent.reasoning")} t={t} onTechnicalError={onTechnicalError} canStartAction={canStartAction} />
        </details>,
      );
      previousPartNeedsTextSeparator = false;
      continue;
    }

    previousPartNeedsTextSeparator = false;
    const summaryText = buildToolCallSummaryText(part.name, part.input, t);
    elements.push(
      <details
        key={`tool-${index}`}
        className={`chat-tool-call chat-tool-call-${part.status}`}
        data-testid="chat-tool-call"
        data-tool-call-kind="tool"
        data-tool-call-name={part.name}
        data-tool-call-status={part.status}
        data-tool-call-summary={summaryText}
      >
        <summary className="chat-tool-call-summary">
          <span className="chat-tool-call-summary-main" title={summaryText}>{summaryText}</span>
          {renderRunningStatus(part.status, t)}
        </summary>
        {renderToolCallSection(t("chatMessageContent.request"), part.input, "input", t, onTechnicalError, canStartAction)}
        {renderToolCallSection(t("chatMessageContent.response"), part.output, "output", t, onTechnicalError, canStartAction)}
      </details>,
    );
  }

  return elements;
}

/**
 * Live and persisted messages share the review renderer; stored source remains unchanged.
 * Assistant work parts sit in one collapsible work block before the answer.
 */
export function renderStoredMessageContent(
  message: StoredMessage,
  t: Translate,
  onTechnicalError: ChatMessageTechnicalErrorHandler,
  canStartAction: () => boolean,
  isRunActive: boolean,
  renderContext: MessageRenderContext = { workspaceId: null, localReadVersion: 0 },
): ReactElement {
  const contentLength = message.content.length;
  const lastWorkPartIndex = message.role === "assistant" ? findLastWorkPartIndex(message.content) : -1;
  const elements = lastWorkPartIndex < 0
    ? renderContentPartRange(message, 0, contentLength, t, onTechnicalError, canStartAction, renderContext)
    : [
      <ChatWorkBlock
        key="work-block"
        timestamp={message.timestamp}
        completedAt={message.completedAt}
        isRunActive={isRunActive}
        isAutoOpen={isWorkBlockAutoOpen(
          message.content.slice(lastWorkPartIndex + 1),
          isRunActive,
          message.isStopped,
          message.isError,
        )}
      >
        {renderContentPartRange(message, 0, lastWorkPartIndex + 1, t, onTechnicalError, canStartAction, renderContext)}
      </ChatWorkBlock>,
      ...renderContentPartRange(message, lastWorkPartIndex + 1, contentLength, t, onTechnicalError, canStartAction, renderContext),
    ];

  const textParts = message.content.filter((part) => part.type === "text");
  const sourceText = textParts.map((part) => part.text).join("\n\n");
  return <>
    {elements}
    <ChatMathCopyButton
      key={sourceText}
      text={sourceText}
      hasRenderedMath={textParts.some((part) => {
        const renderedText = localizeChatTerminalError(message.errorCode, part.text, t);
        return renderedText.includes("$") && hasEligibleReviewMath(renderedText);
      })}
      sectionTitle={t(message.role === "user" ? "chatMessageContent.request" : "chatMessageContent.response")}
      t={t}
      onTechnicalError={onTechnicalError}
      canStartAction={canStartAction}
    />
  </>;
}
