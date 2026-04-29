import { useEffect, useRef, useState, type RefObject } from "react";
import {
  MAX_WIDTH,
  MIN_WIDTH,
  calculateSidebarWidthFromPointer,
} from "./chatHelpers";

type UseChatSidebarResizeParams = Readonly<{
  chatWidth: number;
  rootRef: RefObject<HTMLDivElement | null>;
  setChatWidth: (width: number) => void;
}>;

export type ChatSidebarResize = Readonly<{
  beginResizeDrag: () => void;
  isDragging: boolean;
  localWidth: number;
}>;

export function useChatSidebarResize(params: UseChatSidebarResizeParams): ChatSidebarResize {
  const {
    chatWidth,
    rootRef,
    setChatWidth,
  } = params;
  const [localWidth, setLocalWidth] = useState<number>(chatWidth);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragWidthRef = useRef<number>(chatWidth);

  useEffect(() => {
    setLocalWidth(chatWidth);
    dragWidthRef.current = chatWidth;
  }, [chatWidth]);

  useEffect(() => {
    if (!isDragging) {
      return;
    }

    function handleMouseMove(event: MouseEvent): void {
      const sidebarElement = rootRef.current;
      if (sidebarElement === null) {
        return;
      }

      const sidebarBounds = sidebarElement.getBoundingClientRect();
      const nextWidth = calculateSidebarWidthFromPointer(
        event.clientX,
        sidebarBounds.left,
        MIN_WIDTH,
        MAX_WIDTH,
      );

      dragWidthRef.current = nextWidth;
      setLocalWidth(nextWidth);
    }

    function handleMouseUp(): void {
      setIsDragging(false);
      setChatWidth(dragWidthRef.current);
    }

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging, rootRef, setChatWidth]);

  function beginResizeDrag(): void {
    dragWidthRef.current = localWidth;
    setIsDragging(true);
  }

  return {
    beginResizeDrag,
    isDragging,
    localWidth,
  };
}
