import type { ReactElement } from "react";
import { autoLocalePreference, supportedLocales, useI18n } from "../../i18n";
import { LanguagePicker } from "./LanguagePicker";
import { SettingsGroup, SettingsShell } from "./SettingsShared";

export function LanguageSettingsScreen(): ReactElement {
  const { locale, localePreference, getLocaleName, t } = useI18n();
  const localeLabel = getLocaleName(locale);
  const localePreferenceLabel = localePreference === autoLocalePreference
    ? t("locale.preferenceAuto")
    : getLocaleName(localePreference);

  return (
    <SettingsShell
      title={t("locale.labels.appLanguage")}
      subtitle={t("settingsDevice.languageCardDescription")}
      activeTab="general"
    >
      <SettingsGroup>
        <div className="settings-nav-list">
          <article className="content-card settings-summary-card" data-testid="settings-language-preference-card">
            <div className="cell-stack">
              <strong className="panel-subtitle">{t("settingsDevice.languageCardTitle")}</strong>
              <p className="subtitle">{t("settingsDevice.languageCardDescription")}</p>
            </div>
            <div className="cell-stack">
              <span className="cell-secondary">{t("locale.labels.languageSelection")}</span>
              <LanguagePicker />
            </div>
          </article>
          <article className="content-card settings-summary-card">
            <span className="cell-secondary">{t("locale.labels.appLanguage")}</span>
            <strong className="panel-subtitle">{localeLabel}</strong>
          </article>
          <article className="content-card settings-summary-card">
            <span className="cell-secondary">{t("locale.labels.languagePreference")}</span>
            <strong className="panel-subtitle">{localePreferenceLabel}</strong>
          </article>
          <article className="content-card settings-summary-card">
            <span className="cell-secondary">{t("locale.labels.languageSelection")}</span>
            <p className="subtitle">
              {supportedLocales.map(getLocaleName).join(", ")}
            </p>
          </article>
        </div>
      </SettingsGroup>
    </SettingsShell>
  );
}
