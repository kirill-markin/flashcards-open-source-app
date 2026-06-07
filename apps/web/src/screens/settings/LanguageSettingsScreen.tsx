import type { ReactElement } from "react";
import {
  autoLocalePreference,
  supportedLocales,
  type Locale,
  type LocalePreference,
  type TranslationKey,
  useI18n,
} from "../../i18n";
import { SettingsGroup, SettingsShell } from "./SettingsShared";

type LocaleNameTranslationKey = `locale.names.${Locale}`;

function localeNameKey(locale: Locale): LocaleNameTranslationKey {
  return `locale.names.${locale}`;
}

function parseLocalePreference(value: string): LocalePreference {
  if (value === autoLocalePreference) {
    return autoLocalePreference;
  }

  const locale = supportedLocales.find((supportedLocale) => supportedLocale === value);
  if (locale !== undefined) {
    return locale;
  }

  throw new Error(`Unsupported locale preference: ${value}`);
}

function formatLocalePreferenceLabel(
  localePreference: LocalePreference,
  t: (key: TranslationKey) => string,
): string {
  if (localePreference === autoLocalePreference) {
    return t("locale.preferenceAuto");
  }

  return t(localeNameKey(localePreference));
}

export function LanguageSettingsScreen(): ReactElement {
  const { locale, localePreference, setLocalePreference, t } = useI18n();
  const localeLabel = t(localeNameKey(locale));
  const localePreferenceLabel = formatLocalePreferenceLabel(localePreference, t);

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
            <label className="cell-stack" htmlFor="settings-language-preference">
              <span className="cell-secondary">{t("locale.labels.languageSelection")}</span>
              <select
                id="settings-language-preference"
                className="settings-select"
                value={localePreference}
                data-testid="settings-language-preference-select"
                onChange={(event) => {
                  setLocalePreference(parseLocalePreference(event.target.value));
                }}
              >
                <option value={autoLocalePreference}>{t("locale.preferenceAuto")}</option>
                {supportedLocales.map((supportedLocale) => (
                  <option key={supportedLocale} value={supportedLocale}>
                    {t(localeNameKey(supportedLocale))}
                  </option>
                ))}
              </select>
            </label>
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
              {supportedLocales.map((supportedLocale) => t(localeNameKey(supportedLocale))).join(", ")}
            </p>
          </article>
        </div>
      </SettingsGroup>
    </SettingsShell>
  );
}
