import {
  createContext,
  useContext,
  useMemo,
  type ReactElement,
  type RefObject,
} from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import {
  ManagedMediaReference,
  parseManagedMediaUrlReference,
  reviewMarkdownUrlTransform,
} from "./ReviewManagedMedia";
import {
  parseManagedImageMarkdownReferences,
  type ManagedMediaReferenceState,
} from "../../../../media/managedMediaMarkdown";
import { cardTextHasPreviewText } from "../../../../components/cardPreviewMarkdown";
import { classifyReviewContentPresentation } from "./reviewContentPresentation";
import { normalizeReviewMarkdownForWeb } from "./reviewMarkdownNormalization";
import reviewMathBlocks, {
  escapeRejectedReviewMathDollars,
  normalizeReviewPlainTextEscapedDollars,
} from "./reviewMathBlocks";
import { ReviewMathBlock } from "./ReviewMathBlock";
import { ReviewCardCopyButton, type ReviewCardCopyButtonHandle } from "./ReviewCardCopyButton";
import { useI18n } from "../../../../i18n";
import { ReviewRepetitionBadgeIcon } from "../../../shared/ReviewProgressBadgeIcon";
import { reviewSpeechShortcutKey } from "../../input/reviewShortcutKeys";
import { ReviewShortcutHint } from "../ReviewShortcutHint";

const REVIEW_MARKDOWN_GALLERY_SEPARATOR_PATTERN = /^[ \t\r\n]*$/;

type ReviewMarkdownRenderContextValue = Readonly<{
  /** Empty when the side has other text, so its empty-alt images stay decorative for screen readers. */
  emptyImageAltText: string;
  localReadVersion: number;
  workspaceId: string | null;
}>;

const ReviewMarkdownRenderContext = createContext<ReviewMarkdownRenderContextValue | null>(null);

export type ReviewCardShortcutTarget = Readonly<{
  copyButtonRef: RefObject<ReviewCardCopyButtonHandle | null>;
}>;

export type ReviewCardSideProps = Readonly<{
  aiButtonAriaLabel: string | null;
  contentClassName: string;
  copySource: Readonly<{ cardId: string; side: "front" | "back"; sourceText: string }> | null;
  editButtonDisabled: boolean;
  isSpeaking: boolean;
  label: string;
  onEdit: (() => void) | null;
  onOpenAi: (() => void) | null;
  onOpenTextSelection?: () => void;
  onToggleSpeech: () => void;
  /** Shown at the end of the side label line; null hides it. */
  repetitionCount: number | null;
  /** Set only on the side the speech and copy shortcuts act on. */
  shortcutTarget: ReviewCardShortcutTarget | null;
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
  isShortcutTarget: boolean;
  isSpeaking: boolean;
  onToggleSpeech: () => void;
}>;

export type ReviewCardEditButtonProps = Readonly<{
  disabled: boolean;
  onEdit: () => void;
}>;

function reviewMarkdownClassName(tagName: string): string {
  return `review-markdown-${tagName}`;
}

/**
 * An image-only paragraph with two or more images renders as a gallery; separators may be only
 * spaces, tabs, and soft line breaks, so a hard break or any other content keeps the paragraph as is.
 */
function readReviewMarkdownGalleryColumnCount(node: ExtraProps["node"]): number | null {
  if (node === undefined) {
    return null;
  }

  let imageCount = 0;
  for (const child of node.children) {
    if (child.type === "element" && child.tagName === "img") {
      imageCount += 1;
      continue;
    }
    if (child.type === "text" && REVIEW_MARKDOWN_GALLERY_SEPARATOR_PATTERN.test(child.value)) {
      continue;
    }

    return null;
  }

  if (imageCount < 2) {
    return null;
  }
  if (imageCount === 4) {
    return 2;
  }

  return Math.min(imageCount, 3);
}

function createManagedMediaReferenceKey(
  workspaceId: string | null,
  mediaAssetId: string,
  referenceState: ManagedMediaReferenceState,
): string {
  return JSON.stringify([workspaceId, mediaAssetId, referenceState]);
}

function useReviewMarkdownRenderContext(): ReviewMarkdownRenderContextValue {
  const contextValue = useContext(ReviewMarkdownRenderContext);
  if (contextValue === null) {
    throw new Error("Review markdown render context is unavailable");
  }

  return contextValue;
}

const reviewMarkdownComponents: Components = {
  div: function ReviewMarkdownDiv({ children, node }) {
    const formulaSource = node?.properties["data-formula-source"];
    const delimitedSource = node?.properties["data-delimited-source"];
    if (typeof formulaSource === "string" && typeof delimitedSource === "string") {
      return <ReviewMathBlock formulaSource={formulaSource} delimitedSource={delimitedSource} inline={false} />;
    }
    if (formulaSource !== undefined || delimitedSource !== undefined) {
      throw new Error("Review formula block was missing its source properties");
    }

    return <div>{children}</div>;
  },
  span: function ReviewMarkdownSpan({ children, node }) {
    const formulaSource = node?.properties["data-formula-source"];
    const delimitedSource = node?.properties["data-delimited-source"];
    if (typeof formulaSource === "string" && typeof delimitedSource === "string") {
      return <ReviewMathBlock formulaSource={formulaSource} delimitedSource={delimitedSource} inline />;
    }
    if (formulaSource !== undefined || delimitedSource !== undefined) {
      throw new Error("Review formula span was missing its source properties");
    }

    return <span>{children}</span>;
  },
  a: function ReviewMarkdownAnchor({ children, href, title }) {
    const { t } = useI18n();
    const { localReadVersion, workspaceId } = useReviewMarkdownRenderContext();
    const mediaReference = parseManagedMediaUrlReference(href);
    if (mediaReference !== null) {
      return (
        <ManagedMediaReference
          key={createManagedMediaReferenceKey(workspaceId, mediaReference.mediaAssetId, mediaReference.state)}
          altText=""
          emptyImageAltText={t("reviewScreen.media.imageAlt")}
          localReadVersion={localReadVersion}
          mediaAssetId={mediaReference.mediaAssetId}
          referencePresentation="link"
          referenceState={mediaReference.state}
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
  p: function ReviewMarkdownParagraph({ children, node }) {
    const galleryColumnCount = readReviewMarkdownGalleryColumnCount(node);
    if (galleryColumnCount !== null) {
      return (
        <p
          className={`${reviewMarkdownClassName("p")} ${reviewMarkdownClassName("gallery")}`}
          data-gallery-columns={galleryColumnCount}
        >
          {children}
        </p>
      );
    }

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
    const { emptyImageAltText, localReadVersion, workspaceId } = useReviewMarkdownRenderContext();
    const mediaReference = parseManagedMediaUrlReference(src);
    if (mediaReference !== null) {
      return (
        <ManagedMediaReference
          key={createManagedMediaReferenceKey(workspaceId, mediaReference.mediaAssetId, mediaReference.state)}
          altText={alt ?? ""}
          emptyImageAltText={emptyImageAltText}
          localReadVersion={localReadVersion}
          mediaAssetId={mediaReference.mediaAssetId}
          referencePresentation="image"
          referenceState={mediaReference.state}
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

export function ReviewCardMarkdown(props: Readonly<{
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
  const containsDollarSign = normalizedText.includes("$");
  // `remark-math` segments dollar-delimited source far more loosely than the
  // review math contract does, so the rejected dollars are escaped before the
  // parse and the transform only has to confirm the nodes it is handed.
  const markdownText = containsDollarSign ? escapeRejectedReviewMathDollars(normalizedText) : normalizedText;
  const { t } = useI18n();
  // Only image renders read this, so text without image syntax skips the second parse (chat streams through here).
  const hasPreviewText = useMemo(() => !text.includes("![") || cardTextHasPreviewText(text), [text]);
  const emptyImageAltText = hasPreviewText ? "" : t("reviewScreen.media.imageAlt");

  return (
    <ReviewMarkdownRenderContext.Provider value={{ emptyImageAltText, localReadVersion, workspaceId }}>
      <ReactMarkdown
        urlTransform={reviewMarkdownUrlTransform}
        components={reviewMarkdownComponents}
        remarkPlugins={containsDollarSign
          ? [remarkGfm, remarkMath, reviewMathBlocks]
          : [remarkGfm]}
      >
        {markdownText}
      </ReactMarkdown>
    </ReviewMarkdownRenderContext.Provider>
  );
}

function ReviewEditIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
    isShortcutTarget,
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
      aria-keyshortcuts={isShortcutTarget ? reviewSpeechShortcutKey : undefined}
      disabled={disabled}
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 14H2V10H5L10 6V18L5 14Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14 9C15.333 10.2 15.333 13.8 14 15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M17.5 6.5C20.5 9.4 20.5 14.6 17.5 17.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {isShortcutTarget ? <ReviewShortcutHint keyLabel={reviewSpeechShortcutKey} /> : null}
    </button>
  );
}

export function ReviewCardEditButton(props: ReviewCardEditButtonProps): ReactElement {
  const { disabled, onEdit } = props;
  const { t } = useI18n();
  const label = t("reviewScreen.actions.edit");

  return (
    <button
      type="button"
      className="review-card-edit-btn"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onEdit}
    >
      <ReviewEditIcon />
    </button>
  );
}

/** Quiet caption metadata on the label line, not a chip, so the line keeps its height. */
function ReviewCardRepetitionCount(props: Readonly<{ repetitionCount: number }>): ReactElement {
  const { repetitionCount } = props;
  const { t, formatNumber } = useI18n();
  const value = repetitionCount === 0 ? t("reviewScreen.repetitionBadgeNew") : formatNumber(repetitionCount);

  return (
    <span className="review-card-repetitions">
      <ReviewRepetitionBadgeIcon />
      <span aria-hidden="true">{value}</span>
      <span className="review-metadata-chip-accessible-label">
        {t("reviewScreen.repetitionBadgeAriaLabel", { value })}
      </span>
    </span>
  );
}

export function ReviewCardSide(props: ReviewCardSideProps): ReactElement {
  const {
    aiButtonAriaLabel,
    contentClassName,
    copySource,
    editButtonDisabled,
    isSpeaking,
    label,
    onEdit,
    onOpenAi,
    onOpenTextSelection,
    onToggleSpeech,
    repetitionCount,
    shortcutTarget,
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
  const { t, locale } = useI18n();
  const presentationMode = parseManagedImageMarkdownReferences(text).length > 0
    ? "markdown"
    : classifyReviewContentPresentation(text);

  return (
    <div
      className={surfaceClassName === undefined ? "review-card-surface" : surfaceClassName}
      data-testid={surfaceTestId}
      data-card-id={surfaceCardId}
      data-card-front-text={surfaceFrontText}
    >
      <div className="review-card-side-head">
        {onOpenTextSelection === undefined ? (
          <div className="review-label">{label}</div>
        ) : (
          <button
            type="button"
            className="review-label review-label-button"
            aria-label={t("reviewScreen.selectTextAriaLabel", { side: label })}
            aria-haspopup="dialog"
            title={t("reviewScreen.selectTextAriaLabel", { side: label })}
            onClick={(event) => {
              event.currentTarget.focus();
              onOpenTextSelection();
            }}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {label}
          </button>
        )}
        {repetitionCount === null ? null : <ReviewCardRepetitionCount repetitionCount={repetitionCount} />}
      </div>
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
            ) : normalizeReviewPlainTextEscapedDollars(text)}
          </div>
        </div>

        {copySource !== null || showSpeechButton || onEdit !== null || showAiButton ? (
          <div className="review-card-actions">
            {copySource !== null ? (
              <ReviewCardCopyButton
                key={JSON.stringify([workspaceId, copySource.cardId, copySource.side, copySource.sourceText, locale])}
                side={copySource.side}
                sideLabel={label}
                sourceText={copySource.sourceText}
                shortcutHandleRef={shortcutTarget?.copyButtonRef ?? null}
              />
            ) : null}
            {showSpeechButton ? (
              <ReviewCardSpeechButton
                ariaLabel={speechButtonAriaLabel ?? label}
                disabled={speechButtonDisabled}
                isShortcutTarget={shortcutTarget !== null}
                isSpeaking={isSpeaking}
                onToggleSpeech={onToggleSpeech}
              />
            ) : null}
            {onEdit !== null ? <ReviewCardEditButton disabled={editButtonDisabled} onEdit={onEdit} /> : null}
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
