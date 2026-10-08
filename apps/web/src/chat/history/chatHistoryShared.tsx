import { ApiError } from "../../api";
import { useI18n } from "../../i18n";
import type { WebAppOperation } from "../../observability/webObservability";

export type ReportHistoryError = (error: unknown, operation: WebAppOperation, sessionId: string | null) => void;

export function isChatUnavailableError(error: unknown): boolean {
  return error instanceof ApiError && error.statusCode === 404;
}

export function ChatHistoryLoading(props: { title: string }): React.JSX.Element {
  return (
    <div className="chat-empty chat-empty-loading" aria-live="polite">
      <p className="chat-empty-title">{props.title}</p>
      <div className="chat-loading-lines" aria-hidden="true">
        <span className="chat-loading-line chat-loading-line-title" />
        <span className="chat-loading-line" />
        <span className="chat-loading-line chat-loading-line-short" />
      </div>
    </div>
  );
}

export function ChatHistoryLoadError(props: { message: string; onRetry: () => void; testId: string }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="chat-history-error" role="alert" data-testid={props.testId}>
      <p>{props.message}</p>
      <button
        type="button"
        className="chat-history-item-action"
        onClick={props.onRetry}
        data-testid={`${props.testId}-retry`}
      >
        {t("common.retry")}
      </button>
    </div>
  );
}
