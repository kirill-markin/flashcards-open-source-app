import { act } from "react";
import {
  clickElement,
  dispatchKeydown,
} from "../testSupport/ReviewScreenTestSupport";

export async function flushReviewScreenPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function dispatchPointerDown(element: Element): void {
  element.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
}

export async function pointerDownElementAsync(element: Element): Promise<void> {
  await act(async () => {
    dispatchPointerDown(element);
  });
}

export async function pointerDownAndClickElementAsync(element: Element): Promise<boolean> {
  let wasPointerDownPrevented = false;
  await act(async () => {
    const pointerDownEvent = new Event("pointerdown", { bubbles: true, cancelable: true });
    element.dispatchEvent(pointerDownEvent);
    wasPointerDownPrevented = pointerDownEvent.defaultPrevented;
    clickElement(element);
  });

  return wasPointerDownPrevented;
}

export async function keydownElementAsync(element: HTMLElement, key: string): Promise<void> {
  await act(async () => {
    dispatchKeydown(element, key);
  });
}

export async function composingKeydownElementAsync(element: HTMLElement, key: string): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, isComposing: true }));
  });
}

export function getActiveReviewFilterOption(activeOptionOwner: HTMLElement): HTMLElement {
  const activeOptionId = activeOptionOwner.getAttribute("aria-activedescendant");
  if (activeOptionId === null) {
    throw new Error("Review filter search input is missing aria-activedescendant");
  }

  const activeOption = document.getElementById(activeOptionId);
  if (!(activeOption instanceof HTMLElement)) {
    throw new Error(`Review filter active option was not found: ${activeOptionId}`);
  }

  return activeOption;
}
