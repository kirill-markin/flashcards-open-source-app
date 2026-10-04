import type { JSX } from "react";
import "./dataTable.css";

const previewLength = 80;

/** A JSON text table cell: a short value inline, a longer one as a preview that expands to the full text. */
export function JsonPreviewCell(props: Readonly<{ json: string }>): JSX.Element {
  if (props.json.length <= previewLength) {
    return <code className="json-preview-text">{props.json}</code>;
  }
  return (
    <details className="json-preview">
      <summary><code className="json-preview-text">{`${props.json.slice(0, previewLength)}…`}</code></summary>
      <pre className="json-preview-full">{props.json}</pre>
    </details>
  );
}
