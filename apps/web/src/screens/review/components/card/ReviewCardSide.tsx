import {
  createContext,
  useContext,
  type ReactElement,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ManagedMediaReference,
  parseManagedMediaAssetId,
  reviewMarkdownUrlTransform,
} from "./ReviewManagedMedia";
import { classifyReviewContentPresentation } from "./reviewContentPresentation";

const REVIEW_MARKDOWN_FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})/;
const REVIEW_MARKDOWN_SYMBOL_ONLY_LIST_ITEM_PATTERN = /^(\s{0,3}[-*+]\s+)([+*\-#>])(\s*)$/;

type MarkdownFenceMarker = "`" | "~";
type ReviewMarkdownRenderContextValue = Readonly<{
  localReadVersion: number;
  workspaceId: string | null;
}>;

const ReviewMarkdownRenderContext = createContext<ReviewMarkdownRenderContextValue | null>(null);

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
  speechButtonDisabled: boolean;
  localReadVersion: number;
  surfaceCardId?: string;
  surfaceClassName?: string;
  surfaceFrontText?: string;
  surfaceTestId?: string;
  text: string;
  workspaceId: string | null;
}>;

export type ReviewCardSpeechButtonProps = Readonly<{
  ariaLabel: string;
  disabled: boolean;
  isSpeaking: boolean;
  onToggleSpeech: () => void;
}>;

function reviewMarkdownClassName(tagName: string): string {
  return `review-markdown-${tagName}`;
}

function createManagedMediaReferenceKey(workspaceId: string | null, mediaAssetId: string): string {
  return JSON.stringify([workspaceId, mediaAssetId]);
}

function useReviewMarkdownRenderContext(): ReviewMarkdownRenderContextValue {
  const contextValue = useContext(ReviewMarkdownRenderContext);
  if (contextValue === null) {
    throw new Error("Review markdown render context is unavailable");
  }

  return contextValue;
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

const reviewMarkdownComponents: Components = {
  a: function ReviewMarkdownAnchor({ children, href, title }) {
    const { localReadVersion, workspaceId } = useReviewMarkdownRenderContext();
    const mediaAssetId = parseManagedMediaAssetId(href);
    if (mediaAssetId !== null) {
      return (
        <ManagedMediaReference
          key={createManagedMediaReferenceKey(workspaceId, mediaAssetId)}
          altText=""
          localReadVersion={localReadVersion}
          mediaAssetId={mediaAssetId}
          referencePresentation="link"
          workspaceId={workspaceId}
        >
          {children}
        </ManagedMediaReference>
      );
    }

    return <a className={reviewMarkdownClassName("a")} href={href} title={title}>{children}</a>;
  },
  h1: function ReviewMarkdownH1({ children }) {
    return <h1 className={reviewMarkdownClassName("h1")}>{children}</h1>;
  },
  h2: function ReviewMarkdownH2({ children }) {
    return <h2 className={reviewMarkdownClassName("h2")}>{children}</h2>;
  },
  h3: function ReviewMarkdownH3({ children }) {
    return <h3 className={reviewMarkdownClassName("h3")}>{children}</h3>;
  },
  h4: function ReviewMarkdownH4({ children }) {
    return <h4 className={reviewMarkdownClassName("h4")}>{children}</h4>;
  },
  h5: function ReviewMarkdownH5({ children }) {
    return <h5 className={reviewMarkdownClassName("h5")}>{children}</h5>;
  },
  h6: function ReviewMarkdownH6({ children }) {
    return <h6 className={reviewMarkdownClassName("h6")}>{children}</h6>;
  },
  p: function ReviewMarkdownParagraph({ children }) {
    return <p className={reviewMarkdownClassName("p")}>{children}</p>;
  },
  ul: function ReviewMarkdownUnorderedList({ children }) {
    return <ul className={reviewMarkdownClassName("ul")}>{children}</ul>;
  },
  ol: function ReviewMarkdownOrderedList({ children }) {
    return <ol className={reviewMarkdownClassName("ol")}>{children}</ol>;
  },
  li: function ReviewMarkdownListItem({ children }) {
    return <li className={reviewMarkdownClassName("li")}>{children}</li>;
  },
  blockquote: function ReviewMarkdownBlockquote({ children }) {
    return <blockquote className={reviewMarkdownClassName("blockquote")}>{children}</blockquote>;
  },
  hr: function ReviewMarkdownHorizontalRule() {
    return <hr className={reviewMarkdownClassName("hr")} />;
  },
  table: function ReviewMarkdownTable({ children }) {
    return <table className={reviewMarkdownClassName("table")}>{children}</table>;
  },
  thead: function ReviewMarkdownTableHead({ children }) {
    return <thead className={reviewMarkdownClassName("thead")}>{children}</thead>;
  },
  tbody: function ReviewMarkdownTableBody({ children }) {
    return <tbody className={reviewMarkdownClassName("tbody")}>{children}</tbody>;
  },
  tr: function ReviewMarkdownTableRow({ children }) {
    return <tr className={reviewMarkdownClassName("tr")}>{children}</tr>;
  },
  th: function ReviewMarkdownTableHeaderCell({ children }) {
    return <th className={reviewMarkdownClassName("th")}>{children}</th>;
  },
  td: function ReviewMarkdownTableCell({ children }) {
    return <td className={reviewMarkdownClassName("td")}>{children}</td>;
  },
  pre: function ReviewMarkdownPre({ children }) {
    return <pre className={reviewMarkdownClassName("pre")}>{children}</pre>;
  },
  img: function ReviewMarkdownImage({ alt, src, title }) {
    const { localReadVersion, workspaceId } = useReviewMarkdownRenderContext();
    const mediaAssetId = parseManagedMediaAssetId(src);
    if (mediaAssetId !== null) {
      return (
        <ManagedMediaReference
          key={createManagedMediaReferenceKey(workspaceId, mediaAssetId)}
          altText={alt ?? ""}
          localReadVersion={localReadVersion}
          mediaAssetId={mediaAssetId}
          referencePresentation="image"
          workspaceId={workspaceId}
        >
          {alt ?? ""}
        </ManagedMediaReference>
      );
    }

    return (
      <img
        className="review-markdown-img"
        src={src}
        alt={alt ?? ""}
        title={title}
        loading="lazy"
        decoding="async"
      />
    );
  },
  code: function ReviewMarkdownCode({ children, className }) {
    return (
      <code className={`${reviewMarkdownClassName("code")}${className === undefined ? "" : ` ${className}`}`}>
        {children}
      </code>
    );
  },
};

function ReviewCardMarkdown(props: Readonly<{
  localReadVersion: number;
  text: string;
  workspaceId: string | null;
}>): ReactElement {
  const {
    localReadVersion,
    text,
    workspaceId,
  } = props;
  const normalizedText = normalizeReviewMarkdownForWeb(text);

  return (
    <ReviewMarkdownRenderContext.Provider value={{ localReadVersion, workspaceId }}>
      <ReactMarkdown
        urlTransform={reviewMarkdownUrlTransform}
        components={reviewMarkdownComponents}
        remarkPlugins={[remarkGfm]}
      >
        {normalizedText}
      </ReactMarkdown>
    </ReviewMarkdownRenderContext.Provider>
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

export function ReviewCardSpeechButton(props: ReviewCardSpeechButtonProps): ReactElement {
  const {
    ariaLabel,
    disabled,
    isSpeaking,
    onToggleSpeech,
  } = props;
  const className = `review-card-speech-btn${isSpeaking && disabled === false ? " review-card-speech-btn-active" : ""}`;

  function handleClick(): void {
    if (disabled) {
      return;
    }

    onToggleSpeech();
  }

  return (
    <button
      type="button"
      className={className}
      onClick={handleClick}
      aria-label={ariaLabel}
      disabled={disabled}
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 14H2V10H5L10 6V18L5 14Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14 9C15.333 10.2 15.333 13.8 14 15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M17.5 6.5C20.5 9.4 20.5 14.6 17.5 17.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
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
    speechButtonDisabled,
    localReadVersion,
    surfaceCardId,
    surfaceClassName,
    surfaceFrontText,
    surfaceTestId,
    text,
    workspaceId,
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
            {presentationMode === "markdown" ? (
              <ReviewCardMarkdown localReadVersion={localReadVersion} text={text} workspaceId={workspaceId} />
            ) : text}
          </div>
        </div>

        {showSpeechButton || showAiButton ? (
          <div className="review-card-actions">
            {showSpeechButton ? (
              <ReviewCardSpeechButton
                ariaLabel={speechButtonAriaLabel ?? label}
                disabled={speechButtonDisabled}
                isSpeaking={isSpeaking}
                onToggleSpeech={onToggleSpeech}
              />
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
