/** Runs the callback once the current frame is painted; the returned function cancels it. */
export function runAfterNextPaint(callback: () => void): () => void {
  let timeoutId: number | null = null;
  // The animation frame runs just before the paint; the timeout runs after it.
  const animationFrameId = window.requestAnimationFrame(() => {
    timeoutId = window.setTimeout(callback, 0);
  });

  return () => {
    window.cancelAnimationFrame(animationFrameId);
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  };
}
