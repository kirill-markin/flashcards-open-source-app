import type { ReactElement } from "react";
import type { StoredMessage } from "./useChatHistory";

/**
 * Maps machine-oriented tool names into short user-facing labels while keeping
 * unsupported or future tool names visible instead of dropping them.
 *
 * Mirror:
 * `apps/ios/Flashcards/Flashcards/AI/AIChatView.swift::aiChatToolLabel`
 */
export function formatToolLabel(name: string): string {
  if (name === "sql") return "SQL";
  if (name === "get_cloud_settings") return "Cloud settings";
  if (name === "list_outbox") return "Outbox";
  if (name === "code_execution" || name === "code_interpreter") return "Code execution";
  if (name === "web_search") return "Web search";
  return name;
}

/**
 * Mirror:
 * `apps/ios/Flashcards/Flashcards/AI/AIChatView.swift::aiChatToolPreview`
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

    previousPartWasAttachment = false;
    const toolPreview = extractToolCallPreview(part.name, part.input);
    elements.push(
      <details
        key={`tool-${index}`}
        className={`chat-tool-call${part.status === "started" ? " chat-tool-call-started" : ""}`}
      >
        <summary className="chat-tool-call-summary">
          {formatToolLabel(part.name)}
          {toolPreview === null ? null : `: ${toolPreview}`}
        </summary>
        {part.input !== null ? <pre className="chat-tool-call-input">{part.input}</pre> : null}
        {part.output !== null ? <pre className="chat-tool-call-output">{part.output}</pre> : null}
      </details>,
    );
  }

  return <>{elements}</>;
}
