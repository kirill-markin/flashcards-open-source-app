import type { JSX } from "react";
import { formatChartNoteNumber, type PlacedChartNote } from "./chartNotes";

/**
 * The short texts of a chart's notes, numbered as their lines' tags; nothing when there are none.
 * `null` means the chart is loading: one hidden row is reserved, so a ready chart's key does not push the page down.
 */
export function ChartNotesKey(props: Readonly<{ notes: ReadonlyArray<PlacedChartNote> | null }>): JSX.Element | null {
  if (props.notes === null) return <p className="chart-notes-key chart-notes-key-placeholder" aria-hidden="true">{"\u00a0"}</p>;
  if (props.notes.length === 0) return null;
  return (
    <p className="chart-notes-key">
      {props.notes.map((note, index) => (
        <span key={note.number}>{index === 0 ? "" : " · "}{formatChartNoteNumber(note.number)} {note.shortText}</span>
      ))}
    </p>
  );
}
