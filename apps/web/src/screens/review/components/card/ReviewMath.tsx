import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { initRatex, renderLatexToDisplayList, renderToCanvas } from "ratex-wasm";
import "ratex-wasm/fonts.css";
import { useI18n } from "../../../../i18n";

const RATE_X_FONT_SHORTHANDS: ReadonlyArray<string> = [
  "16px KaTeX_AMS",
  "16px KaTeX_Caligraphic",
  "16px KaTeX_Fraktur",
  "bold 16px KaTeX_Fraktur",
  "16px KaTeX_Main",
  "bold 16px KaTeX_Main",
  "italic 16px KaTeX_Main",
  "italic bold 16px KaTeX_Main",
  "italic 16px KaTeX_Math",
  "italic bold 16px KaTeX_Math",
  "16px KaTeX_SansSerif",
  "bold 16px KaTeX_SansSerif",
  "italic 16px KaTeX_SansSerif",
  "16px KaTeX_Script",
  "16px KaTeX_Size1",
  "16px KaTeX_Size2",
  "16px KaTeX_Size3",
  "16px KaTeX_Size4",
  "16px KaTeX_Typewriter",
];

type ReviewMathRenderState =
  | Readonly<{
    renderIdentity: string;
    status: "loading";
  }>
  | Readonly<{
    depthEm: number;
    heightEm: number;
    renderIdentity: string;
    status: "ready";
    widthEm: number;
  }>
  | Readonly<{
    renderIdentity: string;
    status: "failed";
  }>;

type ReviewMathRenderEnvironment = Readonly<{
  color: string;
  fontSize: string;
  pixelRatio: number;
}>;

let ratexInitializationPromise: Promise<void> | null = null;

function initializeRatex(): Promise<void> {
  if (ratexInitializationPromise !== null) {
    return ratexInitializationPromise;
  }

  ratexInitializationPromise = Promise.all([
    initRatex(),
    ...RATE_X_FONT_SHORTHANDS.map(async (fontShorthand): Promise<void> => {
      await document.fonts.load(fontShorthand);
    }),
  ]).then(() => undefined);

  return ratexInitializationPromise;
}

function readErrorName(error: unknown): string {
  return error instanceof Error && error.name.trim() !== "" ? error.name : typeof error;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== "" ? error.message : String(error);
}

function logRatexFailure(source: string, isDisplay: boolean, error: unknown): void {
  console.error("Review formula rendering failed", {
    source,
    presentation: isDisplay ? "display" : "inline",
    errorName: readErrorName(error),
    errorMessage: readErrorMessage(error),
    error,
  });
}

function resolveRatexColor(color: string): string {
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = 1;
  colorCanvas.height = 1;
  const context = colorCanvas.getContext("2d");
  if (context === null) {
    throw new Error("Review formula color resolution failed: Canvas 2D context is unavailable");
  }

  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
  return `#${[red, green, blue, alpha]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

function validateRatexMetric(metricName: string, value: number): number {
  if (Number.isFinite(value) === false || value < 0) {
    throw new RangeError(`Review formula metric is invalid: metric=${metricName}, value=${value}`);
  }

  return value;
}

function readReviewMathRenderEnvironment(container: HTMLElement): ReviewMathRenderEnvironment {
  const computedStyle = getComputedStyle(container);
  return {
    color: computedStyle.color,
    fontSize: computedStyle.fontSize,
    pixelRatio: window.devicePixelRatio,
  };
}

function isSameReviewMathRenderEnvironment(
  left: ReviewMathRenderEnvironment,
  right: ReviewMathRenderEnvironment,
): boolean {
  return left.color === right.color
    && left.fontSize === right.fontSize
    && left.pixelRatio === right.pixelRatio;
}

function MathRenderContent(props: Readonly<{
  delimitedSource: string;
  errorMessage: string;
  renderState: ReviewMathRenderState;
  source: string;
}>): ReactElement | null {
  const { delimitedSource, errorMessage, renderState, source } = props;

  if (renderState.status === "ready") {
    return null;
  }

  if (renderState.status === "loading") {
    return <span className="review-markdown-math-loading" dir="ltr">{delimitedSource}</span>;
  }

  const errorAriaLabel = source === "" ? errorMessage : `${source}. ${errorMessage}`;

  return (
    <span aria-label={errorAriaLabel} className="review-markdown-math-error" role="alert">
      <code className="review-markdown-math-error-source" dir="ltr">{delimitedSource}</code>
      <span className="review-markdown-math-error-message">{errorMessage}</span>
    </span>
  );
}

export function ReviewMathFormula(props: Readonly<{
  delimitedSource: string;
  isDisplay: boolean;
  source: string;
}>): ReactElement {
  const { delimitedSource, isDisplay, source } = props;
  const { t } = useI18n();
  const inlineContainerRef = useRef<HTMLSpanElement>(null);
  const displayContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [renderRevision, setRenderRevision] = useState<number>(0);
  const renderIdentity = JSON.stringify([source, isDisplay, renderRevision]);
  const [renderState, setRenderState] = useState<ReviewMathRenderState>({
    renderIdentity,
    status: "loading",
  });

  useEffect(() => {
    const container = isDisplay ? displayContainerRef.current : inlineContainerRef.current;
    if (container === null) {
      throw new Error(`Review formula container is unavailable: presentation=${isDisplay ? "display" : "inline"}`);
    }

    let lastEnvironment = readReviewMathRenderEnvironment(container);
    let pixelRatioQuery: MediaQueryList | null = null;
    const colorEnvironmentQueries = [
      window.matchMedia("(forced-colors: active)"),
      window.matchMedia("(prefers-color-scheme: dark)"),
    ];

    function handleEnvironmentChange(): void {
      const nextEnvironment = readReviewMathRenderEnvironment(container);
      if (isSameReviewMathRenderEnvironment(lastEnvironment, nextEnvironment)) {
        return;
      }

      lastEnvironment = nextEnvironment;
      setRenderRevision((currentRevision) => currentRevision + 1);
    }

    function observeCurrentPixelRatio(): void {
      pixelRatioQuery?.removeEventListener("change", handlePixelRatioChange);
      pixelRatioQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      pixelRatioQuery.addEventListener("change", handlePixelRatioChange);
    }

    function handlePixelRatioChange(): void {
      handleEnvironmentChange();
      observeCurrentPixelRatio();
    }

    const resizeObserver = new ResizeObserver(handleEnvironmentChange);
    resizeObserver.observe(container);
    const styleObserver = new MutationObserver(handleEnvironmentChange);
    let styleElement: HTMLElement | null = container;
    while (styleElement !== null) {
      styleObserver.observe(styleElement, { attributes: true });
      styleElement = styleElement.parentElement;
    }

    for (const colorEnvironmentQuery of colorEnvironmentQueries) {
      colorEnvironmentQuery.addEventListener("change", handleEnvironmentChange);
    }
    window.addEventListener("resize", handleEnvironmentChange);
    observeCurrentPixelRatio();

    return () => {
      resizeObserver.disconnect();
      styleObserver.disconnect();
      for (const colorEnvironmentQuery of colorEnvironmentQueries) {
        colorEnvironmentQuery.removeEventListener("change", handleEnvironmentChange);
      }
      window.removeEventListener("resize", handleEnvironmentChange);
      pixelRatioQuery?.removeEventListener("change", handlePixelRatioChange);
    };
  }, [isDisplay]);

  useEffect(() => {
    let isCancelled = false;
    setRenderState({ renderIdentity, status: "loading" });

    async function renderFormula(): Promise<void> {
      try {
        await initializeRatex();
        if (isCancelled) {
          return;
        }

        const container = isDisplay ? displayContainerRef.current : inlineContainerRef.current;
        const canvas = canvasRef.current;
        if (container === null || canvas === null) {
          throw new Error(`Review formula canvas is unavailable: presentation=${isDisplay ? "display" : "inline"}`);
        }

        const computedStyle = getComputedStyle(container);
        const fontSizePx = Number.parseFloat(computedStyle.fontSize);
        if (Number.isFinite(fontSizePx) === false || fontSizePx <= 0) {
          throw new RangeError(`Review formula font size is invalid: fontSize=${computedStyle.fontSize}`);
        }

        const color = resolveRatexColor(computedStyle.color);
        const displayList = renderLatexToDisplayList(source, color);
        const depthEm = validateRatexMetric("depth", displayList.depth);
        const formulaHeightEm = validateRatexMetric("height", displayList.height);
        const widthEm = validateRatexMetric("width", displayList.width);
        const pixelRatio = window.devicePixelRatio;
        if (Number.isFinite(pixelRatio) === false || pixelRatio <= 0) {
          throw new RangeError(`Review formula pixel ratio is invalid: pixelRatio=${pixelRatio}`);
        }

        renderToCanvas(displayList, canvas, {
          backgroundColor: "transparent",
          fontSize: fontSizePx * pixelRatio,
          padding: 0,
        });

        if (isCancelled) {
          return;
        }

        setRenderState({
          depthEm,
          heightEm: formulaHeightEm + depthEm,
          renderIdentity,
          status: "ready",
          widthEm,
        });
      } catch (error) {
        if (isCancelled) {
          return;
        }

        logRatexFailure(source, isDisplay, error);
        setRenderState({ renderIdentity, status: "failed" });
      }
    }

    void renderFormula();

    return () => {
      isCancelled = true;
    };
  }, [isDisplay, renderIdentity, source]);

  const currentRenderState: ReviewMathRenderState = renderState.renderIdentity === renderIdentity
    ? renderState
    : { renderIdentity, status: "loading" };

  const metricsStyle: CSSProperties | undefined = currentRenderState.status === "ready"
    ? {
      height: `${currentRenderState.heightEm}em`,
      verticalAlign: isDisplay ? undefined : `${-currentRenderState.depthEm}em`,
      width: `${currentRenderState.widthEm}em`,
    }
    : undefined;
  const content: ReactNode = (
    <>
      <canvas
        aria-hidden="true"
        className="review-markdown-math-canvas"
        hidden={currentRenderState.status !== "ready"}
        ref={canvasRef}
        style={isDisplay ? metricsStyle : undefined}
      />
      <MathRenderContent
        delimitedSource={delimitedSource}
        errorMessage={t("reviewScreen.formulaRenderError")}
        renderState={currentRenderState}
        source={source}
      />
    </>
  );

  if (isDisplay) {
    return (
      <div
        aria-label={currentRenderState.status === "failed" ? undefined : source}
        className="review-markdown-math-display"
        dir={currentRenderState.status === "ready" ? "ltr" : undefined}
        ref={displayContainerRef}
        role={currentRenderState.status === "failed" ? undefined : "img"}
      >
        {content}
      </div>
    );
  }

  return (
    <span
      aria-label={currentRenderState.status === "failed" ? undefined : source}
      className="review-markdown-math-inline"
      dir={currentRenderState.status === "ready" ? "ltr" : undefined}
      ref={inlineContainerRef}
      role={currentRenderState.status === "failed" ? undefined : "img"}
      style={metricsStyle}
    >
      {content}
    </span>
  );
}
