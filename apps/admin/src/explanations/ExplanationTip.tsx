import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";

// How long hover keeps holding the tip after the pointer leaves it: enough to cross the gap down to
// the text, which opens below the `(i)`, short enough that leaving still reads as closing it.
const HOVER_RELEASE_DELAY_MS = 180;

type TipProps = Readonly<{
  /** The button's accessible name, which says what the explanation is about. */
  label: string;
  /** Unique on the page; the button's `aria-describedby` points at it. */
  explanationId: string;
  children: ReactNode;
}>;

type TipKind = "explanation" | "warning";

// U+FE0E asks for the text glyph, so the `⚠` takes the button's colour instead of an emoji's.
const tipKinds: Readonly<Record<TipKind, Readonly<{ className: string; glyph: string }>>> = {
  explanation: { className: "explanation-tip", glyph: "i" },
  warning: { className: "explanation-tip explanation-tip-warning", glyph: "\u26A0\uFE0E" },
};

export function ExplanationTip(props: TipProps): JSX.Element {
  return <Tip kind="explanation" label={props.label} explanationId={props.explanationId}>{props.children}</Tip>;
}

/** The same tip behind a `⚠`, for a caveat about the numbers it sits beside. */
export function WarningTip(props: TipProps): JSX.Element {
  return <Tip kind="warning" label={props.label} explanationId={props.explanationId}>{props.children}</Tip>;
}

// An explanation waiting behind an `(i)`. A real button with a described tooltip rather than a
// `title`, because it has to be reachable by keyboard and readable by a screen reader. One boolean
// decides both the class that shows the text and `aria-expanded`, so what a screen reader is told and
// what is on screen cannot disagree; CSS has no reveal rule of its own for that reason. A mouse
// reveals it by resting on the button, and a click decides it outright from whatever is currently
// shown - so a click closes a tooltip the pointer is still holding open, which hover alone could never
// do, and it is also the one way in that a touch device and the browsers that do not focus a button on
// click both have. A closing click holds while hover does and lapses once hover is released, so the
// next hover is a fresh question rather than one already answered. Hover is released a moment after
// the pointer leaves rather than at once, so a pointer crossing the gap down to the text finds it
// still there; coming back within that moment keeps it. Only text that takes the pointer, the section
// explanation, holds hover once the pointer reaches it; the filter explanation lets the pointer through
// to the picker under it, so it closes that moment after the pointer leaves the `(i)`. Touch
// contacts are not hover, or the tap that opens the tooltip would arrive as a click on an already-open
// one and close it again. Where it sits decides only where the text opens, which the stylesheet places
// by the container the tip is rendered in.
function Tip(props: TipProps & Readonly<{ kind: TipKind }>): JSX.Element {
  const [clickedState, setClickedState] = useState<"none" | "open" | "closed">("none");
  const [isPointerOver, setIsPointerOver] = useState<boolean>(false);
  const isOpen = clickedState === "none" ? isPointerOver : clickedState === "open";
  const hoverReleaseTimeoutIdRef = useRef<number | null>(null);

  const cancelHoverRelease = (): void => {
    if (hoverReleaseTimeoutIdRef.current !== null) {
      window.clearTimeout(hoverReleaseTimeoutIdRef.current);
      hoverReleaseTimeoutIdRef.current = null;
    }
  };

  // A filter popover unmounts its tip when it closes, possibly with a release still pending.
  useEffect(() => cancelHoverRelease, []);

  useEffect(() => {
    if (clickedState === "closed" && isPointerOver === false) {
      setClickedState("none");
    }
  }, [clickedState, isPointerOver]);

  return (
    <div
      className={`${tipKinds[props.kind].className}${isOpen ? " open" : ""}`}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") {
          cancelHoverRelease();
          setIsPointerOver(true);
        }
      }}
      onPointerLeave={() => {
        cancelHoverRelease();
        hoverReleaseTimeoutIdRef.current = window.setTimeout(() => {
          hoverReleaseTimeoutIdRef.current = null;
          setIsPointerOver(false);
        }, HOVER_RELEASE_DELAY_MS);
      }}
    >
      <button
        className="explanation-tip-toggle"
        type="button"
        aria-label={props.label}
        aria-describedby={props.explanationId}
        aria-expanded={isOpen}
        onClick={() => setClickedState(isOpen ? "closed" : "open")}
      >
        {tipKinds[props.kind].glyph}
      </button>
      <div id={props.explanationId} className="explanation-tip-text" role="tooltip">
        {props.children}
      </div>
    </div>
  );
}
