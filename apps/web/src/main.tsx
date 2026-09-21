import { AppErrorBoundary, buildReactRootOptions } from "./observability/instrument";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import {
  I18nProvider,
  LocaleBootErrorFallback,
  defaultLocale,
  loadTranslationCatalog,
  readStoredLocalePreference,
  resolveLocaleState,
  type Locale,
} from "./i18n";
import { installStaleBundleReloadGuard } from "./staleBundleReload";
import "./styles/index.css";

installStaleBundleReloadGuard();

// Resolving the prefetch locale must not abort module evaluation, or the root below never renders
// and no error boundary can report it; I18nProvider resolves the same preference inside the
// boundary and raises there.
function resolvePrefetchLocale(): Locale {
  try {
    return resolveLocaleState(readStoredLocalePreference()).locale;
  } catch {
    return defaultLocale;
  }
}

// Requested before the first render so the catalog chunk downloads while the app shell is still
// being parsed.
loadTranslationCatalog(resolvePrefetchLocale()).catch(() => {
  // I18nProvider requests the same catalog and reports the failure through LocaleBootErrorFallback,
  // so this handler exists only to keep the prefetch from also raising an unhandled rejection.
});

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Missing root element");
}

ReactDOM.createRoot(rootElement, buildReactRootOptions()).render(
  <React.StrictMode>
    <AppErrorBoundary fallback={<LocaleBootErrorFallback />}>
      <I18nProvider>
        <App />
      </I18nProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
);
