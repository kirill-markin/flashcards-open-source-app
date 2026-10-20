import type { JSX, ReactNode } from "react";
import { AdminLink } from "../../navigation/AdminLink";

/**
 * A link between the Funnels area and a funnel Details page, carrying the query string the browser is
 * on: the shared selection and every funnel's anchor. The selection is written to the URL after the
 * render that shows it, and an anchor click writes it without a render, so `href` can lag one write;
 * a plain click therefore reads the URL again when it lands.
 */
export function FunnelsLink(
  props: Readonly<{
    path: string;
    className: string;
    testId: string;
    children: ReactNode;
    onNavigate: (path: string) => void;
  }>,
): JSX.Element {
  return (
    <AdminLink
      className={props.className}
      path={`${props.path}${window.location.search}`}
      testId={props.testId}
      onNavigate={() => { props.onNavigate(`${props.path}${window.location.search}`); }}
    >{props.children}</AdminLink>
  );
}
