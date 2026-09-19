import type { JSX } from "react";
import { rootPath } from "../routing";
import { AdminLink } from "./AdminLink";

export function NotFoundPage(
  props: Readonly<{
    pathname: string;
    onNavigate: (path: string) => void;
  }>,
): JSX.Element {
  return (
    <main className="shell centered-shell">
      <section className="state-panel">
        <p className="eyebrow">Admin</p>
        <h1>Page not found</h1>
        <p className="state-copy">The admin app has no page at {props.pathname}.</p>
        <nav className="state-links" aria-label="Admin pages">
          <AdminLink className="state-link" path={rootPath} onNavigate={props.onNavigate}>Back to the admin home page</AdminLink>
        </nav>
      </section>
    </main>
  );
}
