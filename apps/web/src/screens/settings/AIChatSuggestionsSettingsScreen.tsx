import type { ReactElement } from "react";
import { useAIChatPreferences } from "../../chat/preferences/AIChatPreferencesContext";
import { useI18n } from "../../i18n";
import { SettingsGroup, SettingsShell } from "./SettingsShared";

export function AIChatSuggestionsSettingsScreen(): ReactElement {
  const { aiChatComposerSuggestionsEnabled, setAIChatComposerSuggestionsEnabled } = useAIChatPreferences();
  const { t } = useI18n();

  return (
    <SettingsShell
      title={t("aiChatSuggestionsSettings.title")}
      subtitle={t("aiChatSuggestionsSettings.subtitle")}
      activeTab="general"
    >
      <SettingsGroup>
        <article className="content-card settings-toggle-card" data-testid="ai-chat-suggestions-settings-card">
          <div className="settings-nav-card-copy">
            <strong className="panel-subtitle">{t("aiChatSuggestionsSettings.toggleTitle")}</strong>
            <p className="subtitle">{t("aiChatSuggestionsSettings.toggleDescription")}</p>
          </div>
          <button
            className="settings-toggle-control"
            type="button"
            role="switch"
            aria-label={t("aiChatSuggestionsSettings.toggleTitle")}
            aria-checked={aiChatComposerSuggestionsEnabled}
            data-state={aiChatComposerSuggestionsEnabled ? "on" : "off"}
            data-testid="ai-chat-suggestions-toggle"
            onClick={() => setAIChatComposerSuggestionsEnabled(aiChatComposerSuggestionsEnabled === false)}
          >
            <span className="settings-toggle-track" aria-hidden="true">
              <span className="settings-toggle-thumb" />
            </span>
            <span className="settings-toggle-value">
              {aiChatComposerSuggestionsEnabled ? t("common.on") : t("common.off")}
            </span>
          </button>
        </article>
      </SettingsGroup>
    </SettingsShell>
  );
}
