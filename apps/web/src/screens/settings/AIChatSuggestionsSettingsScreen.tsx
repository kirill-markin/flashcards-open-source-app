import { useEffect, useRef, type ReactElement } from "react";
import { useAppData } from "../../appData";
import { useAIChatPreferences } from "../../chat/preferences/AIChatPreferencesContext";
import { useI18n } from "../../i18n";
import { usePremiumPresenter } from "../../premium/PremiumProvider";
import { createPremiumContinuationGuard, useCanCustomizeStyle } from "../../premium/styleSettings";
import { SettingsGroup, SettingsShell } from "./SettingsShared";

export function AIChatSuggestionsSettingsScreen(): ReactElement {
  const { session } = useAppData();
  const { aiChatComposerSuggestionsEnabled, setAIChatComposerSuggestionsEnabled } = useAIChatPreferences();
  const { t } = useI18n();
  const presentPremium = usePremiumPresenter();
  const canCustomize = useCanCustomizeStyle();
  const mountedRef = useRef(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    mountedRef.current = true;
    return (): void => { mountedRef.current = false; };
  }, []);

  function chooseEnabled(nextEnabled: boolean): void {
    if (canCustomize) {
      setAIChatComposerSuggestionsEnabled(nextEnabled);
      return;
    }
    const initiatingSession = sessionRef.current;
    if (initiatingSession === null) return;
    const isCurrentContinuation = createPremiumContinuationGuard(initiatingSession, () => sessionRef.current);
    presentPremium?.({
      reason: "feature",
      entryPoint: "ai_chat_suggestions",
      requiredRank: 20,
      continuation: null,
      onResult: (result): void => {
        if (result !== "granted" || !mountedRef.current || !isCurrentContinuation()) return;
        setAIChatComposerSuggestionsEnabled(nextEnabled);
      },
    });
  }

  return (
    <SettingsShell
      title={t("aiChatSuggestionsSettings.title")}
      subtitle={t("aiChatSuggestionsSettings.subtitle")}
      activeTab="general"
    >
      {!canCustomize ? (
        <SettingsGroup>
          <p className="subtitle" data-testid="ai-chat-suggestions-premium-note">{t("aiChatSuggestionsSettings.premiumNote")}</p>
          <button className="primary-btn" type="button" data-testid="ai-chat-suggestions-premium-open" onClick={() => presentPremium?.({ reason: "offer", entryPoint: "ai_chat_suggestions" })}>
            {t("premium.offer")}
          </button>
        </SettingsGroup>
      ) : null}
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
            onClick={() => chooseEnabled(aiChatComposerSuggestionsEnabled === false)}
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
