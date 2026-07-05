import {
  autoUpdate,
  flip,
  offset as floatingOffset,
  shift,
  size,
  useFloating,
  type Placement,
} from "@floating-ui/react-dom";
import {
  useCallback,
  useEffect,
  useMemo,
  type AriaRole,
  type ReactNode,
  type ReactPortal,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

export type AnchoredFloatingOverlayMinimumWidth =
  | Readonly<{ kind: "reference" }>
  | Readonly<{ kind: "pixels"; pixels: number }>
  | Readonly<{ kind: "reference-or-pixels"; pixels: number }>;

export type AnchoredFloatingOverlayProps = Readonly<{
  isOpen: boolean;
  referenceRef: RefObject<HTMLElement | null>;
  floatingRef: RefObject<HTMLDivElement | null>;
  placement: Placement;
  viewportPaddingPx: number;
  offsetPx: number;
  minimumWidth: AnchoredFloatingOverlayMinimumWidth | null;
  maxWidthPx: number | null;
  maxHeightPx: number | null;
  className: string | null;
  id: string | null;
  role: AriaRole | null;
  ariaLabel: string | null;
  ariaLabelledBy: string | null;
  ariaDescribedBy: string | null;
  ariaModal: boolean | null;
  children: ReactNode;
}>;

export type AnchoredFloatingOutsidePointerDismissOptions = Readonly<{
  triggerRef: RefObject<HTMLElement | null>;
  overlayRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  onClose: () => void;
}>;

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number.`);
  }
}

function assertNonNegativeFiniteNumber(value: number, label: string): void {
  assertFiniteNumber(value, label);

  if (value < 0) {
    throw new RangeError(`${label} must be greater than or equal to 0.`);
  }
}

function assertOptionalNonNegativeFiniteNumber(value: number | null, label: string): void {
  if (value === null) {
    return;
  }

  assertNonNegativeFiniteNumber(value, label);
}

function validateMinimumWidth(minimumWidth: AnchoredFloatingOverlayMinimumWidth | null): void {
  if (minimumWidth === null) {
    return;
  }

  switch (minimumWidth.kind) {
    case "reference":
      return;
    case "pixels":
    case "reference-or-pixels":
      assertNonNegativeFiniteNumber(minimumWidth.pixels, "Anchored floating overlay minimum width");
      return;
  }
}

function validateOverlayProps(
  viewportPaddingPx: number,
  offsetPx: number,
  minimumWidth: AnchoredFloatingOverlayMinimumWidth | null,
  maxWidthPx: number | null,
  maxHeightPx: number | null,
): void {
  assertNonNegativeFiniteNumber(viewportPaddingPx, "Anchored floating overlay viewport padding");
  assertFiniteNumber(offsetPx, "Anchored floating overlay offset");
  assertOptionalNonNegativeFiniteNumber(maxWidthPx, "Anchored floating overlay maximum width");
  assertOptionalNonNegativeFiniteNumber(maxHeightPx, "Anchored floating overlay maximum height");
  validateMinimumWidth(minimumWidth);
}

function getViewportCappedSizePx(availableSizePx: number, configuredMaximumPx: number | null): number {
  const availablePx = Math.max(availableSizePx, 0);

  if (configuredMaximumPx === null) {
    return availablePx;
  }

  return Math.min(configuredMaximumPx, availablePx);
}

function getMinimumWidthPx(
  minimumWidth: AnchoredFloatingOverlayMinimumWidth | null,
  referenceWidthPx: number,
  maximumWidthPx: number,
): number | null {
  if (minimumWidth === null) {
    return null;
  }

  const unconstrainedMinimumPx = (() => {
    switch (minimumWidth.kind) {
      case "reference":
        return referenceWidthPx;
      case "pixels":
        return minimumWidth.pixels;
      case "reference-or-pixels":
        return Math.max(referenceWidthPx, minimumWidth.pixels);
    }
  })();

  return Math.min(unconstrainedMinimumPx, maximumWidthPx);
}

function containsEventTarget(element: HTMLElement | null, target: Node): boolean {
  return element !== null && element.contains(target);
}

export function useAnchoredFloatingOutsidePointerDismiss(
  options: AnchoredFloatingOutsidePointerDismissOptions,
): void {
  const { triggerRef, overlayRef, enabled, onClose } = options;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    function handlePointerDown(event: PointerEvent): void {
      if (!(event.target instanceof Node)) {
        onClose();
        return;
      }

      if (containsEventTarget(triggerRef.current, event.target)) {
        return;
      }

      if (containsEventTarget(overlayRef.current, event.target)) {
        return;
      }

      onClose();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [enabled, onClose, overlayRef, triggerRef]);
}

export function AnchoredFloatingOverlay(props: AnchoredFloatingOverlayProps): ReactPortal | null {
  const {
    isOpen,
    referenceRef,
    floatingRef,
    placement,
    viewportPaddingPx,
    offsetPx,
    minimumWidth,
    maxWidthPx,
    maxHeightPx,
    className,
    id,
    role,
    ariaLabel,
    ariaLabelledBy,
    ariaDescribedBy,
    ariaModal,
    children,
  } = props;

  validateOverlayProps(viewportPaddingPx, offsetPx, minimumWidth, maxWidthPx, maxHeightPx);

  const middleware = useMemo(
    () => [
      floatingOffset(offsetPx),
      flip({ padding: viewportPaddingPx }),
      shift({ padding: viewportPaddingPx }),
      size({
        padding: viewportPaddingPx,
        apply({ availableWidth, availableHeight, rects, elements }): void {
          const cappedMaxWidthPx = getViewportCappedSizePx(availableWidth, maxWidthPx);
          const cappedMaxHeightPx = getViewportCappedSizePx(availableHeight, maxHeightPx);
          const minimumWidthPx = getMinimumWidthPx(minimumWidth, rects.reference.width, cappedMaxWidthPx);

          elements.floating.style.maxWidth = `${cappedMaxWidthPx}px`;
          elements.floating.style.maxHeight = `${cappedMaxHeightPx}px`;
          elements.floating.style.minWidth = minimumWidthPx === null ? "" : `${minimumWidthPx}px`;
        },
      }),
    ],
    [maxHeightPx, maxWidthPx, minimumWidth, offsetPx, viewportPaddingPx],
  );

  const { floatingStyles, refs } = useFloating<HTMLElement>({
    elements: {
      reference: isOpen ? referenceRef.current : null,
    },
    middleware,
    open: isOpen,
    placement,
    strategy: "fixed",
    transform: false,
    whileElementsMounted: autoUpdate,
  });

  const setFloatingElement = useCallback(
    (element: HTMLDivElement | null): void => {
      floatingRef.current = element;
      refs.setFloating(element);
    },
    [floatingRef, refs],
  );

  if (!isOpen || referenceRef.current === null || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      ref={setFloatingElement}
      id={id ?? undefined}
      className={className ?? undefined}
      role={role ?? undefined}
      aria-label={ariaLabel ?? undefined}
      aria-labelledby={ariaLabelledBy ?? undefined}
      aria-describedby={ariaDescribedBy ?? undefined}
      aria-modal={ariaModal ?? undefined}
      style={floatingStyles}
    >
      {children}
    </div>,
    document.body,
  );
}
