import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  initRatex,
  renderLatexToCanvas,
} from "ratex-wasm";
import "ratex-wasm/fonts.css";
import { useI18n } from "../../../../i18n";

const REVIEW_MATH_FONT_SIZE_CSS_PIXELS = 18;
const REVIEW_MATH_PADDING_CSS_PIXELS = 4;
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
  const { delimitedSource, formulaSource } = props;
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [renderState, setRenderState] = useState<ReviewMathRenderState>(null);
  const renderErrorMessage = t("reviewScreen.errors.mathRenderFailed");
  const currentRenderStatus = renderState?.formulaSource === formulaSource ? renderState.status : null;

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
        renderLatexToCanvas(
          formulaSource,
          renderCanvas,
          {
            backgroundColor: "transparent",
            fontSize: REVIEW_MATH_FONT_SIZE_CSS_PIXELS * devicePixelRatio,
            padding: REVIEW_MATH_PADDING_CSS_PIXELS * devicePixelRatio,
          },
          {
            color,
            displayMode: true,
          },
        );
        controller.signal.throwIfAborted();
        renderCanvas.style.width = `${renderCanvas.width / devicePixelRatio}px`;
        renderCanvas.style.height = `${renderCanvas.height / devicePixelRatio}px`;
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
  }, [formulaSource]);

  return (
    <div ref={containerRef} className="review-math-block" data-render-status={currentRenderStatus ?? "loading"}>
      <canvas
        ref={canvasRef}
        className="review-math-block-canvas"
        role="img"
        aria-label={formulaSource}
        hidden={currentRenderStatus !== "ready"}
      />
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
