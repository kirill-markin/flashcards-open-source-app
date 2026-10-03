import { useEffect, useState, type JSX } from "react";
import type { AdminAppConfig } from "../../config";
import { AdminLink } from "../../navigation/AdminLink";
import { getUserPath } from "../../routing";
import { chatToolTextLimit, loadChatTranscript, type CappedText, type ChatItem, type ChatPart, type ChatTranscript } from "./chatsQuery";
import { formatInstant } from "./formatInstant";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; transcript: ChatTranscript | null }>;

function ToolText(props: Readonly<{ label: string; value: CappedText | null }>): JSX.Element {
  if (props.value === null) {
    return <p className="chat-tool-label">{props.label}: none</p>;
  }
  return (
    <>
      <p className="chat-tool-label">{props.label}</p>
      <pre className="chat-pre">{props.value.text}</pre>
      {props.value.totalLength > chatToolTextLimit ? (
        <p className="chat-truncated">
          Truncated: the first {chatToolTextLimit.toLocaleString("en-US")} of {props.value.totalLength.toLocaleString("en-US")} characters are shown.
        </p>
      ) : null}
    </>
  );
}

/** Every value is rendered as React text, never as HTML or markdown. */
function ChatPartView(props: Readonly<{ part: ChatPart }>): JSX.Element {
  const part = props.part;
  switch (part.type) {
    case "text":
      return <p className="chat-text">{part.text}</p>;
    case "card":
      return (
        <dl className="chat-card">
          <dt>Card front</dt><dd className="chat-text">{part.frontText}</dd>
          <dt>Card back</dt><dd className="chat-text">{part.backText}</dd>
          <dt>Tags</dt><dd>{part.tags ?? "none"}</dd>
        </dl>
      );
    case "tool_call":
      return (
        <details className="chat-collapsible">
          <summary>Tool call: {part.name}{part.status === null ? "" : ` (${part.status})`}</summary>
          <ToolText label="Input" value={part.input} />
          <ToolText label="Output" value={part.output} />
        </details>
      );
    case "reasoning_summary":
      return (
        <details className="chat-collapsible">
          <summary>Reasoning summary</summary>
          <p className="chat-text">{part.summary}</p>
        </details>
      );
    case "image":
      return <p className="chat-attachment">[Image attachment, {part.mediaType ?? "unknown media type"}]</p>;
    case "file":
      return <p className="chat-attachment">[File attachment {part.fileName ?? "(no file name)"}, {part.mediaType ?? "unknown media type"}]</p>;
  }
}

function ChatItemView(props: Readonly<{ item: ChatItem }>): JSX.Element {
  const item = props.item;
  return (
    <li className={item.role === "user" ? "chat-item chat-item-user" : "chat-item chat-item-assistant"} data-testid="user-chat-item">
      <p className="chat-item-meta">
        <strong>{item.role}</strong> · {formatInstant(item.createdAt)}{item.state === "completed" ? "" : ` · ${item.state}`}
      </p>
      {item.parts.length === 0 ? <p className="chat-attachment">[No content]</p> : null}
      {item.parts.map((part, index) => <ChatPartView key={index} part={part} />)}
    </li>
  );
}

/** One chat in full. Attachment bodies are stripped and long tool input and output cut in SQL. */
export function ChatView(props: Readonly<{
  config: AdminAppConfig;
  userId: string;
  sessionId: string;
  onNavigate: (path: string) => void;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  const { config, userId, sessionId, onTerminalAdminError } = props;
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    void loadChatTranscript(config, userId, sessionId).then((transcript) => {
      if (!cancelled) setLoadState({ status: "ready", transcript });
    }).catch((error: unknown) => {
      if (cancelled || onTerminalAdminError(error, config)) return;
      setLoadState({ status: "error", message: error instanceof Error ? error.message : "Unexpected user chat query error." });
    });
    return () => { cancelled = true; };
  }, [config, userId, sessionId, onTerminalAdminError, revision]);

  return (
    <div className="user-tab" data-testid="user-chat-view">
      <AdminLink className="user-page-back" path={getUserPath(userId, "chats")} testId="user-chat-back" onNavigate={props.onNavigate}>← All chats</AdminLink>
      {loadState.status === "loading" ? <p className="report-state" aria-live="polite">Loading chat…</p> : null}
      {loadState.status === "error" ? (
        <div className="report-state report-state-error">
          <strong>User chat query failed.</strong><span>{loadState.message}</span>
          <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
        </div>
      ) : null}
      {loadState.status === "ready" && loadState.transcript === null ? (
        <div className="report-state" data-testid="user-chat-not-found">
          <strong>No chat with this id belongs to this user.</strong>
          <span>Chat {sessionId}</span>
        </div>
      ) : null}
      {loadState.status === "ready" && loadState.transcript !== null ? (
        <>
          <div className="chat-view-meta">
            <span className="hero-badge">Chat {sessionId}</span>
            <span className="hero-badge">Workspace {loadState.transcript.session.workspaceName ?? "(none)"}</span>
            <span className="hero-badge">Status {loadState.transcript.session.status}</span>
            <span className="hero-badge">Created {formatInstant(loadState.transcript.session.createdAt)}</span>
            <span className="hero-badge">Updated {formatInstant(loadState.transcript.session.updatedAt)}</span>
            <span className="hero-badge">{loadState.transcript.items.length.toLocaleString("en-US")} messages</span>
          </div>
          <ol className="chat-transcript" data-testid="user-chat-transcript">
            {loadState.transcript.items.map((item) => <ChatItemView key={item.order} item={item} />)}
          </ol>
        </>
      ) : null}
    </div>
  );
}
