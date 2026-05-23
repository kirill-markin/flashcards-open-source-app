import type { ReactElement } from "react";
import ReactMarkdown from "react-markdown";
import { classifyReviewContentPresentation } from "./reviewContentPresentation";

const REVIEW_MARKDOWN_FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})/;
const REVIEW_MARKDOWN_SYMBOL_ONLY_LIST_ITEM_PATTERN = /^(\s{0,3}[-*+]\s+)([+*\-#>])(\s*)$/;

type MarkdownFenceMarker = "`" | "~";

export type ReviewCardSideProps = Readonly<{
  aiButtonAriaLabel: string | null;
  contentClassName: string;
  isSpeaking: boolean;
  label: string;
  onOpenAi: (() => void) | null;
  onToggleSpeech: () => void;
  showAiButton: boolean;
  showSpeechButton: boolean;
  speechButtonAriaLabel: string | null;
  surfaceCardId?: string;
  surfaceClassName?: string;
  surfaceFrontText?: string;
  surfaceTestId?: string;
  text: string;
}>;

function reviewMarkdownClassName(tagName: string): string {
  return `review-markdown-${tagName}`;
}

function toMarkdownFenceMarker(line: string): MarkdownFenceMarker | null {
  const match = REVIEW_MARKDOWN_FENCE_PATTERN.exec(line);

  if (match === null) {
    return null;
  }

  const marker = match[1]?.[0];
  if (marker === "`" || marker === "~") {
    return marker;
  }

  return null;
}

function escapeSymbolOnlyListItem(line: string): string {
  const match = REVIEW_MARKDOWN_SYMBOL_ONLY_LIST_ITEM_PATTERN.exec(line);

  if (match === null) {
    return line;
  }

  const listMarker = match[1];
  const symbolToken = match[2];
  const trailingWhitespace = match[3];

  return `${listMarker}\\${symbolToken}${trailingWhitespace}`;
}

export function normalizeReviewMarkdownForWeb(text: string): string {
  const lines = text.split("\n");
  const normalizedLines: Array<string> = [];
  let activeFenceMarker: MarkdownFenceMarker | null = null;

  for (const line of lines) {
    const lineFenceMarker = toMarkdownFenceMarker(line);

    if (activeFenceMarker !== null) {
      normalizedLines.push(line);

      if (lineFenceMarker === activeFenceMarker) {
        activeFenceMarker = null;
      }

      continue;
    }

    if (lineFenceMarker !== null) {
      activeFenceMarker = lineFenceMarker;
      normalizedLines.push(line);
      continue;
    }

    normalizedLines.push(escapeSymbolOnlyListItem(line));
  }

  return normalizedLines.join("\n");
}

function ReviewCardMarkdown({ text }: Readonly<{ text: string }>): ReactElement {
  const normalizedText = normalizeReviewMarkdownForWeb(text);

  return (
    <ReactMarkdown
      components={{
        h1: ({ children }) => <h1 className={reviewMarkdownClassName("h1")}>{children}</h1>,
        h2: ({ children }) => <h2 className={reviewMarkdownClassName("h2")}>{children}</h2>,
        h3: ({ children }) => <h3 className={reviewMarkdownClassName("h3")}>{children}</h3>,
        h4: ({ children }) => <h4 className={reviewMarkdownClassName("h4")}>{children}</h4>,
        h5: ({ children }) => <h5 className={reviewMarkdownClassName("h5")}>{children}</h5>,
        h6: ({ children }) => <h6 className={reviewMarkdownClassName("h6")}>{children}</h6>,
        p: ({ children }) => <p className={reviewMarkdownClassName("p")}>{children}</p>,
        ul: ({ children }) => <ul className={reviewMarkdownClassName("ul")}>{children}</ul>,
        ol: ({ children }) => <ol className={reviewMarkdownClassName("ol")}>{children}</ol>,
        li: ({ children }) => <li className={reviewMarkdownClassName("li")}>{children}</li>,
        blockquote: ({ children }) => <blockquote className={reviewMarkdownClassName("blockquote")}>{children}</blockquote>,
        hr: () => <hr className={reviewMarkdownClassName("hr")} />,
        table: ({ children }) => <table className={reviewMarkdownClassName("table")}>{children}</table>,
        thead: ({ children }) => <thead className={reviewMarkdownClassName("thead")}>{children}</thead>,
        tbody: ({ children }) => <tbody className={reviewMarkdownClassName("tbody")}>{children}</tbody>,
        tr: ({ children }) => <tr className={reviewMarkdownClassName("tr")}>{children}</tr>,
        th: ({ children }) => <th className={reviewMarkdownClassName("th")}>{children}</th>,
        td: ({ children }) => <td className={reviewMarkdownClassName("td")}>{children}</td>,
        pre: ({ children }) => <pre className={reviewMarkdownClassName("pre")}>{children}</pre>,
        code: ({ children, className }) => (
          <code className={`${reviewMarkdownClassName("code")}${className === undefined ? "" : ` ${className}`}`}>
            {children}
          </code>
        ),
      }}
    >
      {normalizedText}
    </ReactMarkdown>
  );
}

export function ReviewEditIcon(): ReactElement {
  return (
    <svg className="review-pane-edit-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 20H8.5L19 9.5L14.5 5L4 15.5V20Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13 6.5L17.5 11"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ReviewCardSide(props: ReviewCardSideProps): ReactElement {
  const {
    aiButtonAriaLabel,
    contentClassName,
    isSpeaking,
    label,
    onOpenAi,
    onToggleSpeech,
    showAiButton,
    showSpeechButton,
    speechButtonAriaLabel,
    surfaceCardId,
    surfaceClassName,
    surfaceFrontText,
    surfaceTestId,
    text,
  } = props;
  const presentationMode = classifyReviewContentPresentation(text);

  return (
    <div
      className={surfaceClassName === undefined ? "review-card-surface" : surfaceClassName}
      data-testid={surfaceTestId}
      data-card-id={surfaceCardId}
      data-card-front-text={surfaceFrontText}
    >
      <div className="review-label">{label}</div>
      <div className="review-card-body">
        <div className="review-card-content-wrap">
          <div
            className={[
              "review-card-content",
              contentClassName,
              `review-card-content-${presentationMode}`,
            ].join(" ")}
            data-presentation-mode={presentationMode}
          >
            {presentationMode === "markdown" ? <ReviewCardMarkdown text={text} /> : text}
          </div>
        </div>

        {showSpeechButton || showAiButton ? (
          <div className="review-card-actions">
            {showSpeechButton ? (
              <button
                type="button"
                className={`review-card-speech-btn${isSpeaking ? " review-card-speech-btn-active" : ""}`}
                onClick={onToggleSpeech}
                aria-label={speechButtonAriaLabel ?? label}
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 14H2V10H5L10 6V18L5 14Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M14 9C15.333 10.2 15.333 13.8 14 15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M17.5 6.5C20.5 9.4 20.5 14.6 17.5 17.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ) : null}
            {showAiButton && onOpenAi !== null ? (
              <button
                type="button"
                className="review-card-ai-btn"
                onClick={onOpenAi}
                aria-label={aiButtonAriaLabel ?? label}
              >
                AI
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
