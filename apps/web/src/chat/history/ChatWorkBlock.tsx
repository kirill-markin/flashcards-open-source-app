import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { useI18n, type Locale } from "../../i18n";
import type { ContentPart } from "../../types";

/**
 * Work is every part up to and including the last tool call or reasoning summary;
 * the parts after it are the answer. Returns -1 when the message has no work part.
 */
export function findLastWorkPartIndex(content: ReadonlyArray<ContentPart>): number {
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const partType = content[index]?.type;
    if (partType === "tool_call" || partType === "reasoning_summary") {
      return index;
    }
  }

  return -1;
}

/**
 * Open while the run is active; once finished, open only when the answer is missing
 * or the run did not end normally.
 */
export function isWorkBlockAutoOpen(
  answerParts: ReadonlyArray<ContentPart>,
  isRunActive: boolean,
  isStopped: boolean,
  isError: boolean,
): boolean {
  const hasAnswerText = answerParts.some((part) => part.type === "text" && part.text.trim() !== "");
  return isRunActive || isStopped || isError || hasAnswerText === false;
}

function formatDurationUnit(locale: Locale, value: number, unit: "hour" | "minute" | "second"): string {
  return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "narrow" }).format(value);
}

function formatWorkDuration(locale: Locale, durationMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, durationMs) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = hours > 0
    ? [formatDurationUnit(locale, hours, "hour"), formatDurationUnit(locale, minutes, "minute")]
    : minutes > 0
      ? [formatDurationUnit(locale, minutes, "minute"), formatDurationUnit(locale, seconds, "second")]
      : [formatDurationUnit(locale, seconds, "second")];
  return new Intl.ListFormat(locale, { type: "unit", style: "narrow" }).format(parts);
}

/**
 * Ticks once per second only while the run is active.
 */
function useWorkBlockNow(isRunActive: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (isRunActive === false) {
      return undefined;
    }

    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [isRunActive]);
  return now;
}

/**
 * Native details keep the step rows in the DOM while closed. The automatic open value
 * applies only when it changes, so a manual toggle survives re-renders.
 */
export function ChatWorkBlock(props: Readonly<{
  timestamp: number;
  completedAt: number | null;
  isRunActive: boolean;
  isAutoOpen: boolean;
  children: ReactNode;
}>): ReactElement {
  const { timestamp, completedAt, isRunActive, isAutoOpen, children } = props;
  const { t, locale } = useI18n();
  const now = useWorkBlockNow(isRunActive);
  const [isOpen, setIsOpen] = useState(isAutoOpen);
  const [appliedAutoOpen, setAppliedAutoOpen] = useState(isAutoOpen);
  if (appliedAutoOpen !== isAutoOpen) {
    setAppliedAutoOpen(isAutoOpen);
    setIsOpen(isAutoOpen);
  }

  const title = isRunActive
    ? t("chatMessageContent.workBlock.workingFor", { duration: formatWorkDuration(locale, now - timestamp) })
    : completedAt === null
      ? t("chatMessageContent.workBlock.worked")
      : t("chatMessageContent.workBlock.workedFor", { duration: formatWorkDuration(locale, completedAt - timestamp) });

  return (
    <details
      className="chat-work-block"
      data-testid="chat-work-block"
      data-work-block-state={isRunActive ? "running" : "finished"}
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary className="chat-work-block-summary" data-testid="chat-work-block-toggle">
        <span className="chat-work-block-title">{title}</span>
      </summary>
      {children}
      <hr className="chat-work-block-divider" />
    </details>
  );
}
