import { useLayoutEffect, type ReactElement } from "react";
import { enCatalog } from "./catalogs/en";
import { getLocaleDirection } from "./locales";
import { canPersistLocalePreference, persistLocalePreference } from "./runtime";
import { defaultLocale } from "./types";

function reloadPage(): void {
  window.location.reload();
}

function continueInDefaultLocale(): void {
  // The default catalog ships inside the app shell, so pinning it guarantees the next boot has a
  // catalog even while the chunk for the previously selected locale stays unreachable.
  persistLocalePreference(defaultLocale);
  window.location.reload();
}

/**
 * Crash panel for a failure raised by `I18nProvider` itself, above every catalog consumer.
 *
 * Its copy is the default catalog read directly, and the escape hatch is untranslated, because the
 * locale that failed to load is exactly what cannot be rendered here.
 */
export function LocaleBootErrorFallback(): ReactElement {
  // A failure raised on a locale switch leaves the previous language and direction on the document,
  // which would lay this English-only panel out for that language.
  useLayoutEffect(() => {
    document.documentElement.lang = defaultLocale;
    document.documentElement.dir = getLocaleDirection(defaultLocale);
  }, []);

  return (
    <main className="page-state">
      <section className="panel panel-center state-panel" role="alert" aria-live="assertive">
        <h1 className="title">{enCatalog.app.crashTitle}</h1>
        <p className="subtitle">{enCatalog.app.crashMessage}</p>
        <button className="primary-btn" type="button" onClick={reloadPage}>
          {enCatalog.app.crashReload}
        </button>
        {canPersistLocalePreference() === false ? null : (
          <button className="ghost-btn" type="button" onClick={continueInDefaultLocale}>
            Continue in English
          </button>
        )}
      </section>
    </main>
  );
}
