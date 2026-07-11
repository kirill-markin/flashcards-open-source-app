import {
  type FocusEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";

type WorkspaceActionDialogProps = Readonly<{
  isOpen: boolean;
  titleId: string;
  title: string;
  descriptionId: string;
  description: string;
  testId: string;
  initialFocusRef: RefObject<HTMLElement | null>;
  operationReturnFocusRef: RefObject<HTMLElement | null>;
  isOperationSubmitting: boolean;
  onDismiss: () => void;
  children: ReactNode;
}>;

const workspaceDialogFocusableSelector: string = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusableElements(dialog: HTMLElement): ReadonlyArray<HTMLElement> {
  return Array.from(dialog.querySelectorAll<HTMLElement>(workspaceDialogFocusableSelector))
    .filter((element) => element.tabIndex >= 0 && element.getAttribute("aria-hidden") !== "true");
}

function trapFocusInsideDialog(event: KeyboardEvent, dialog: HTMLElement): void {
  const focusableElements = getFocusableElements(dialog);
  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  if (firstElement === undefined || lastElement === undefined) {
    event.preventDefault();
    dialog.focus();
    return;
  }

  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement) || dialog.contains(activeElement) === false) {
    event.preventDefault();
    (event.shiftKey ? lastElement : firstElement).focus();
    return;
  }

  if (event.shiftKey && activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus();
    return;
  }

  if (event.shiftKey === false && activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus();
  }
}

function focusAvailableElement(element: HTMLElement | null): boolean {
  if (
    element === null
    || element.isConnected === false
    || element.tabIndex < 0
    || element.matches(":disabled")
    || element.getAttribute("aria-hidden") === "true"
  ) {
    return false;
  }

  element.focus();
  return document.activeElement === element;
}

export function WorkspaceActionDialog(props: WorkspaceActionDialogProps): ReactElement | null {
  const {
    isOpen,
    titleId,
    title,
    descriptionId,
    description,
    testId,
    initialFocusRef,
    operationReturnFocusRef,
    isOperationSubmitting,
    onDismiss,
    children,
  } = props;
  const dialogRef = useRef<HTMLElement | null>(null);
  const isOperationSubmittingRef = useRef<boolean>(isOperationSubmitting);
  const onDismissRef = useRef<() => void>(onDismiss);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const wasOperationSubmittingRef = useRef<boolean>(false);

  useLayoutEffect(() => {
    isOperationSubmittingRef.current = isOperationSubmitting;
    const wasOperationSubmitting = wasOperationSubmittingRef.current;
    wasOperationSubmittingRef.current = isOpen && isOperationSubmitting;

    if (isOpen === false) {
      return;
    }

    if (wasOperationSubmitting === false && isOperationSubmitting) {
      dialogRef.current?.focus();
      return;
    }

    if (wasOperationSubmitting && isOperationSubmitting === false) {
      const dialog = dialogRef.current;
      const activeElement = document.activeElement;
      const isAnotherSurfaceFocused = activeElement instanceof HTMLElement
        && activeElement !== document.body
        && dialog?.contains(activeElement) === false;
      if (isAnotherSurfaceFocused) {
        return;
      }

      if (focusAvailableElement(operationReturnFocusRef.current)) {
        return;
      }

      if (focusAvailableElement(initialFocusRef.current)) {
        return;
      }

      dialog?.focus();
    }
  }, [initialFocusRef, isOpen, isOperationSubmitting, operationReturnFocusRef]);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (isOpen === false) {
      return undefined;
    }

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const initialFocusElement = initialFocusRef.current;
    if (initialFocusElement === null || initialFocusElement.isConnected === false) {
      dialogRef.current?.focus();
    } else {
      initialFocusElement.focus();
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && isOperationSubmittingRef.current === false) {
        onDismissRef.current();
        return;
      }

      if (event.key === "Tab" && dialogRef.current !== null) {
        trapFocusInsideDialog(event, dialogRef.current);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return (): void => {
      window.removeEventListener("keydown", handleKeyDown);
      const previousFocus = previousFocusRef.current;
      if (previousFocus !== null && previousFocus.isConnected) {
        previousFocus.focus();
      }
      previousFocusRef.current = null;
    };
  }, [initialFocusRef, isOpen]);

  if (isOpen === false || typeof document === "undefined") {
    return null;
  }

  function handleDialogFocus(event: FocusEvent<HTMLElement>): void {
    if (event.target !== event.currentTarget || isOperationSubmittingRef.current) {
      return;
    }

    focusAvailableElement(operationReturnFocusRef.current);
  }

  return createPortal(
    <div className="settings-workspace-dialog-backdrop">
      <section
        ref={dialogRef}
        className="panel settings-workspace-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={isOperationSubmitting}
        tabIndex={-1}
        data-testid={testId}
        onFocus={handleDialogFocus}
      >
        <div className="cell-stack">
          <h2 id={titleId} className="panel-subtitle">{title}</h2>
          <p id={descriptionId} className="subtitle">{description}</p>
        </div>
        {children}
      </section>
    </div>,
    document.body,
  );
}
