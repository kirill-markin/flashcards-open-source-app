import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import {
  initRatex,
  renderLatexToDisplayList,
  renderToCanvas,
} from "ratex-wasm";
import "ratex-wasm/fonts.css";
import { useI18n } from "../../../../i18n";

const REVIEW_MATH_FONT_SIZE_CSS_PIXELS = 18;
const REVIEW_MATH_BLOCK_PADDING_CSS_PIXELS = 4;
// An inline formula sits in a line of prose, so it keeps only the single pixel
// that stops a glyph overhanging the layout box from being clipped.
const REVIEW_MATH_INLINE_PADDING_CSS_PIXELS = 1;
const REVIEW_MATH_FONT_DESCRIPTORS: ReadonlyArray<string> = [
  `400 ${REVIEW_MATH_FONT_SIZE_CSS_PIXELS}px KaTeX_AMS`,
  `400 ${REVIEW_MATH_FONT_SIZE_CSS_PIXELS}px KaTeX_Caligraphic`,
  `700 ${REVIEW_MATH_FONT_SIZE_CSS_PIXELS}px KaTeX_Caligraphic`,
  `400 ${REVIEW_MATH_FONT_SIZE_CSS_PIXELS}px KaTeX_Fraktur`,
  `700 ${REVIEW_MATH_FONT_SIZE_CSS_PIXELS}px KaTeX_Fraktur`,
  `400 ${REVIEW_MATH_FONT_SIZE_CSS_PIXELS}px KaTeX_Main`,
  `italic 400 ${REVIEW_MATH_FONT_SIZE_CSS_PIXELS}px KaTeX_Main`,
  `700 ${REVIEW_MATH_FONT_SIZE_CSS_PIXELS}px KaTeX_Main`,
  `italic 700 ${REVIEW_MATH_FONT_SIZE_CSS_PIXELS}px KaTeX_Main`,
  `italic 400 ${REVIEW_MATH_FONT_SIZE_CSS_PIXELS}px KaTeX_Math`,
  `italic 700 ${REVIEW_MATH_FONT_SIZE_CSS_PIXELS}px KaTeX_Math`,
  `400 ${REVIEW_MATH_FONT_SIZE_CSS_PIXELS}px KaTeX_SansSerif`,
  `italic 400 ${REVIEW_MATH_FONT_SIZE_CSS_PIXELS}px KaTeX_SansSerif`,
  `700 ${REVIEW_MATH_FONT_SIZE_CSS_PIXELS}px KaTeX_SansSerif`,
  `400 ${REVIEW_MATH_FONT_SIZE_CSS_PIXELS}px KaTeX_Script`,
  `400 ${REVIEW_MATH_FONT_SIZE_CSS_PIXELS}px KaTeX_Size1`,
  `400 ${REVIEW_MATH_FONT_SIZE_CSS_PIXELS}px KaTeX_Size2`,
  `400 ${REVIEW_MATH_FONT_SIZE_CSS_PIXELS}px KaTeX_Size3`,
  `400 ${REVIEW_MATH_FONT_SIZE_CSS_PIXELS}px KaTeX_Size4`,
  `400 ${REVIEW_MATH_FONT_SIZE_CSS_PIXELS}px KaTeX_Typewriter`,
];

type ReviewMathBlockProps = Readonly<{
  delimitedSource: string;
  formulaSource: string;
  inline: boolean;
}>;
type ReviewMathRenderState = Readonly<{
  formulaSource: string;
  status: "ready" | "failed";
}> | null;

function readErrorName(error: unknown): string {
  return error instanceof Error && error.name.trim() !== "" ? error.name : typeof error;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== "" ? error.message : String(error);
}

function logReviewMathRenderFailure(formulaSource: string, error: unknown): void {
  console.error("Review formula rendering failed", {
    formulaSource,
    error,
    errorName: readErrorName(error),
    errorMessage: readErrorMessage(error),
  });
}

async function loadReviewMathFonts(signal: AbortSignal): Promise<void> {
  await Promise.all(REVIEW_MATH_FONT_DESCRIPTORS.map((descriptor) => document.fonts.load(descriptor)));
  signal.throwIfAborted();
}

export function ReviewMathBlock(props: ReviewMathBlockProps): ReactElement {
  const { delimitedSource, formulaSource, inline } = props;
  const { t } = useI18n();
  const containerRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [renderState, setRenderState] = useState<ReviewMathRenderState>(null);
  const renderErrorMessage = t("reviewScreen.errors.mathRenderFailed");
  const currentRenderStatus = renderState?.formulaSource === formulaSource ? renderState.status : null;

  // The container is a `span` inline and a `div` as a block, so one callback ref
  // keeps a single element reference across both shapes.
  const setContainerElement = useCallback((element: HTMLElement | null): void => {
    containerRef.current = element;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (container === null || canvas === null) {
      throw new Error("Review formula canvas was unavailable during rendering");
    }
    const renderContainer = container;
    const renderCanvas = canvas;

    const controller = new AbortController();
    canvas.width = 0;
    canvas.height = 0;
    canvas.style.width = "";
    canvas.style.height = "";
    container.style.verticalAlign = "";

    async function renderFormula(): Promise<void> {
      try {
        await initRatex();
        controller.signal.throwIfAborted();
        await loadReviewMathFonts(controller.signal);
        const color = getComputedStyle(renderContainer).getPropertyValue("--text").trim();
        if (color === "") {
          throw new Error("Review formula rendering could not resolve the theme text color");
        }
        const devicePixelRatio = window.devicePixelRatio;
        const paddingCssPixels = inline
          ? REVIEW_MATH_INLINE_PADDING_CSS_PIXELS
          : REVIEW_MATH_BLOCK_PADDING_CSS_PIXELS;
        // The display list carries the layout box, so the canvas takes its final
        // size in the same task that paints it and the line never reflows twice.
        const displayList = renderLatexToDisplayList(formulaSource, {
          color,
          displayMode: inline === false,
        });
        renderToCanvas(displayList, renderCanvas, {
          backgroundColor: "transparent",
          fontSize: REVIEW_MATH_FONT_SIZE_CSS_PIXELS * devicePixelRatio,
          padding: paddingCssPixels * devicePixelRatio,
        });
        controller.signal.throwIfAborted();
        renderCanvas.style.width = `${renderCanvas.width / devicePixelRatio}px`;
        renderCanvas.style.height = `${renderCanvas.height / devicePixelRatio}px`;
        if (inline) {
          // `depth` is the descent below the formula baseline in em, and the
          // padding sits below that, so together they are the distance from the
          // surrounding text baseline to the bottom edge of the canvas box.
          // Verified against `ratex-wasm@0.1.14`: `renderToCanvas` sizes the
          // canvas as `ceil((height + depth) * fontSize + 2 * padding)` device
          // pixels and translates by `padding` before drawing, so the full
          // padding sits below the baseline. That `ceil` can leave up to one
          // device pixel of unaccounted slack, which is below the visible
          // threshold. A raised construction can report a negative depth, so the
          // descent is clamped to keep the offset from becoming an invalid
          // `--Npx` that the browser would drop.
          const baselineDescentEm = Math.max(displayList.depth, 0);
          const baselineOffsetCssPixels = baselineDescentEm * REVIEW_MATH_FONT_SIZE_CSS_PIXELS + paddingCssPixels;
          renderContainer.style.verticalAlign = `-${baselineOffsetCssPixels}px`;
        }
        setRenderState({
          formulaSource,
          status: "ready",
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        logReviewMathRenderFailure(formulaSource, error);
        setRenderState({
          formulaSource,
          status: "failed",
        });
      }
    }

    void renderFormula();
    return () => controller.abort();
  }, [formulaSource, inline]);

  const formulaCanvas = (
    <canvas
      ref={canvasRef}
      className={inline ? "review-math-inline-canvas" : "review-math-block-canvas"}
      role="img"
      aria-label={formulaSource}
      hidden={currentRenderStatus !== "ready"}
    />
  );

  if (inline) {
    return (
      <span
        ref={setContainerElement}
        className="review-math-inline"
        data-render-status={currentRenderStatus ?? "loading"}
      >
        {formulaCanvas}
        {currentRenderStatus === "failed" ? (
          <span
            className="review-math-inline-error"
            role="alert"
            aria-label={`${formulaSource}. ${renderErrorMessage}`}
          >
            <code className="review-math-block-source">{delimitedSource}</code>
            <span className="review-math-inline-error-message">{renderErrorMessage}</span>
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <div
      ref={setContainerElement}
      className="review-math-block"
      data-render-status={currentRenderStatus ?? "loading"}
    >
      {formulaCanvas}
      {currentRenderStatus === "failed" ? (
        <div
          className="review-math-block-error"
          role="alert"
          aria-label={`${formulaSource}. ${renderErrorMessage}`}
        >
          <code className="review-math-block-source">{delimitedSource}</code>
          <span>{renderErrorMessage}</span>
        </div>
      ) : null}
    </div>
  );
}
