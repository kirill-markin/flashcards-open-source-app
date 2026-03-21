import { useCallback, useEffect, useRef, useState } from "react";

type UseTransientMessageResult = Readonly<{
  message: string;
  showMessage: (nextMessage: string) => void;
}>;

export function useTransientMessage(durationMs: number): UseTransientMessageResult {
  const [message, setMessage] = useState<string>("");
  const timeoutRef = useRef<number | null>(null);

  const showMessage = useCallback(function showMessage(nextMessage: string): void {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }

    setMessage(nextMessage);
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      setMessage("");
    }, durationMs);
  }, [durationMs]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    message,
    showMessage,
  };
}
