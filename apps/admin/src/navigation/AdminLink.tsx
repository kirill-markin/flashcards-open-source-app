import type { JSX, MouseEvent, ReactNode } from "react";

function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0
    && !event.metaKey
    && !event.ctrlKey
    && !event.shiftKey
    && !event.altKey;
}

/**
 * In-app link. A modified click or a middle click keeps the native browser behaviour, so opening a
 * route in a new tab or window still works.
 */
export function AdminLink(
  props: Readonly<{
    path: string;
    className: string;
    ariaCurrent?: "page" | undefined;
    testId?: string | undefined;
    children: ReactNode;
    onNavigate: (path: string) => void;
  }>,
): JSX.Element {
  function handleClick(event: MouseEvent<HTMLAnchorElement>): void {
    if (!isPlainLeftClick(event)) {
      return;
    }

    event.preventDefault();
    props.onNavigate(props.path);
  }

  return (
    <a
      href={props.path}
      className={props.className}
      aria-current={props.ariaCurrent}
      data-testid={props.testId}
      onClick={handleClick}
    >
      {props.children}
    </a>
  );
}
