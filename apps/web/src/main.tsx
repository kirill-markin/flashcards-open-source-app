import { buildReactRootOptions } from "./observability/instrument";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./i18n";
import { installStaleBundleReloadGuard } from "./staleBundleReload";
import "./styles/index.css";

installStaleBundleReloadGuard();

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Missing root element");
}

ReactDOM.createRoot(rootElement, buildReactRootOptions()).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
);
