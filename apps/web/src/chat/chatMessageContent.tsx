import type { ReactElement } from "react";
import type { StoredMessage } from "./useChatHistory";

/**
 * Maps machine-oriented tool names into short user-facing labels while keeping
 * unsupported or future tool names visible instead of dropping them.
 */
export function formatToolLabel(name: string): string {
  if (name === "get_workspace_context") return "Workspace context";
  if (name === "list_tags") return "List tags";
  if (name === "list_cards") return "List cards";
  if (name === "get_cards") return "Get cards";
  if (name === "search_cards") return "Search cards";
  if (name === "list_due_cards") return "List due cards";
  if (name === "list_decks") return "List decks";
  if (name === "search_decks") return "Search decks";
  if (name === "get_decks") return "Get decks";
  if (name === "list_review_history") return "Review history";
  if (name === "get_scheduler_settings") return "Scheduler settings";
  if (name === "get_cloud_settings") return "Cloud settings";
  if (name === "list_outbox") return "Outbox";
  if (name === "summarize_deck_state") return "Deck summary";
  if (name === "create_cards") return "Create cards";
  if (name === "update_cards") return "Update cards";
  if (name === "delete_cards") return "Delete cards";
  if (name === "create_decks") return "Create decks";
  if (name === "update_decks") return "Update decks";
  if (name === "delete_decks") return "Delete decks";
  if (name === "code_execution" || name === "code_interpreter") return "Code execution";
  if (name === "web_search") return "Web search";
  return name;
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
    elements.push(
      <details
        key={`tool-${index}`}
        className={`chat-tool-call${part.status === "started" ? " chat-tool-call-started" : ""}`}
      >
        <summary className="chat-tool-call-summary">{formatToolLabel(part.name)}</summary>
        {part.input !== null ? <pre className="chat-tool-call-input">{part.input}</pre> : null}
        {part.output !== null ? <pre className="chat-tool-call-output">{part.output}</pre> : null}
      </details>,
    );
  }

  return <>{elements}</>;
}
