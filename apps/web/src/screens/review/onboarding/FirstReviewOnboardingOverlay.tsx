import { autoUpdate } from "@floating-ui/react-dom";
import { useLayoutEffect, useRef, type ReactPortal, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useAccountAccentColor } from "../../../premium/accentColor";
import { drawPencilGuide, type PencilGuideRect } from "./pencilDrawing";

type Props = Readonly<{
  target: HTMLButtonElement | null;
  surfaceRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  headerRef: RefObject<HTMLDivElement | null>;
  controlsRef: RefObject<HTMLDivElement | null>;
  stage: "reveal" | "again";
}>;

function measureContent(content: HTMLElement): ReadonlyArray<DOMRect> {
  const rects: Array<DOMRect> = [];
  for (const element of content.querySelectorAll(".review-card-content")) {
    const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = text.nextNode(); node !== null; node = text.nextNode()) {
      if (node.textContent?.trim() === "") continue;
      range.selectNodeContents(node);
      rects.push(...range.getClientRects());
    }
    for (const media of element.querySelectorAll("img, svg, video, canvas, hr, mjx-container")) {
      rects.push(media.getBoundingClientRect());
    }
  }
  return rects;
}

export function FirstReviewOnboardingOverlay(props: Props): ReactPortal {
  const { target, surfaceRef, contentRef, headerRef, controlsRef, stage } = props;
  const { effectiveColor } = useAccountAccentColor();
  const overlayRef = useRef<HTMLDivElement>(null);
  const firstFrameRef = useRef<HTMLCanvasElement>(null);
  const secondFrameRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const surface = surfaceRef.current;
    const content = contentRef.current;
    const header = headerRef.current;
    const controls = controlsRef.current;
    if (overlay !== null) overlay.hidden = true;
    if (overlay === null || surface === null || content === null || header === null || controls === null || target === null) return;
    let disposed = false;

    function update(): void {
      if (disposed || overlay === null || surface === null || content === null || header === null || controls === null || target === null) return;
      const bounds = target.getBoundingClientRect();
      const pane = surface.getBoundingClientRect();
      const viewport = window.visualViewport;
      let left = Math.max(pane.left, viewport?.offsetLeft ?? 0);
      let top = Math.max(pane.top, viewport?.offsetTop ?? 0);
      let right = Math.min(pane.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth));
      let bottom = Math.min(pane.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight));
      for (let parent = surface.parentElement; parent !== null; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const rect = parent.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
          left = Math.max(left, rect.left);
          right = Math.min(right, rect.right);
        }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
          top = Math.max(top, rect.top);
          bottom = Math.min(bottom, rect.bottom);
        }
      }
      const visible = document.visibilityState === "visible" && !target.disabled
        && bounds.width > 0 && bounds.height > 0 && bounds.left >= left && bounds.right <= right
        && bounds.top >= top && bounds.bottom <= bottom;
      overlay.hidden = !visible;
      if (!visible) return;
      const contentClip = { left, top, right, bottom };
      left = viewport?.offsetLeft ?? 0;
      top = viewport?.offsetTop ?? 0;
      right = left + (viewport?.width ?? window.innerWidth);
      bottom = top + (viewport?.height ?? window.innerHeight);
      const width = right - left;
      const height = bottom - top;
      Object.assign(overlay.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
      const targetStyle = getComputedStyle(target);
      const scale = bounds.width / target.offsetWidth;
      const pixelRatio = window.devicePixelRatio;
      const relativeRect = (rect: DOMRect): PencilGuideRect => ({
        left: rect.left - left, top: rect.top - top, right: rect.right - left, bottom: rect.bottom - top,
      });
      const controlRects = [header.getBoundingClientRect(),
        ...Array.from(content.querySelectorAll("button"), (button) => button.getBoundingClientRect()),
        ...Array.from(controls.querySelectorAll("button"))
          .filter((button) => button !== target).map((button) => button.getBoundingClientRect()),
      ].filter((rect) => rect.width > 0 && rect.height > 0);
      const controlBounds = controlRects.map(relativeRect);
      const contentBounds = measureContent(content).map((rect): PencilGuideRect => {
        let visibleTop = Math.max(contentClip.top, rect.top);
        let visibleBottom = Math.min(contentClip.bottom, rect.bottom);
        // Sticky buttons paint over card text, but their gaps remain visible.
        for (const control of [bounds, ...controlRects]) {
          if (control.left <= rect.left && control.right >= rect.right
            && control.top < visibleBottom && control.bottom > visibleTop) {
            if (control.top <= visibleTop) visibleTop = Math.max(visibleTop, control.bottom);
            else visibleBottom = Math.min(visibleBottom, control.top);
          }
        }
        return { left: Math.max(contentClip.left, rect.left) - left, top: visibleTop - top,
          right: Math.min(contentClip.right, rect.right) - left, bottom: visibleBottom - top };
      }).filter((rect) => rect.left < rect.right && rect.top < rect.bottom);
      [firstFrameRef.current, secondFrameRef.current].forEach((canvas, frame) => {
        if (canvas === null) return;
        canvas.width = Math.ceil(width * pixelRatio);
        canvas.height = Math.ceil(height * pixelRatio);
        const context = canvas.getContext("2d");
        if (context === null) throw new Error("First review onboarding requires Canvas 2D support.");
        context.scale(pixelRatio, pixelRatio);
        drawPencilGuide(context, {
          left: bounds.left - left,
          top: bounds.top - top,
          width: bounds.width,
          height: bounds.height,
          radius: parseFloat(targetStyle.borderTopLeftRadius) * scale,
          surfaceWidth: width,
          surfaceHeight: height,
          contentBounds,
          controlBounds,
        }, effectiveColor, frame);
      });
    }

    const stopTarget = autoUpdate(target, overlay, update, { animationFrame: true });
    const stopSurface = autoUpdate(surface, overlay, update);
    const stopContent = autoUpdate(content, overlay, update, { animationFrame: true });
    const stopHeader = autoUpdate(header, overlay, update);
    const stopControls = autoUpdate(controls, overlay, update);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    document.addEventListener("visibilitychange", update);
    document.fonts.addEventListener("loadingdone", update);
    void document.fonts.ready.then(() => { if (!disposed) update(); });
    return (): void => {
      disposed = true;
      overlay.hidden = true;
      stopTarget();
      stopSurface();
      stopContent();
      stopHeader();
      stopControls();
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      document.removeEventListener("visibilitychange", update);
      document.fonts.removeEventListener("loadingdone", update);
    };
  }, [contentRef, controlsRef, effectiveColor, headerRef, surfaceRef, target]);

  return createPortal(
    <div ref={overlayRef} hidden className="first-review-onboarding" aria-hidden="true"
      data-testid="first-review-onboarding" data-onboarding-target={stage}>
      <canvas ref={firstFrameRef} className="first-review-pencil first-review-pencil-a" data-pencil-seed="7823" />
      <canvas ref={secondFrameRef} className="first-review-pencil first-review-pencil-b" data-pencil-seed="48191" />
    </div>,
    document.body,
  );
}
