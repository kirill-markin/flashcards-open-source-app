import type { ReactElement } from "react";
import { useI18n } from "../../../i18n";
import { SettingsShell } from "../SettingsShared";

const repositoryUrl: string = "https://github.com/kirill-markin/flashcards-open-source-app";
const thirdPartyNoticesUrl: string = "https://github.com/kirill-markin/flashcards-open-source-app/blob/main/THIRD_PARTY_NOTICES.md";
const reviewOwlAnimationUrl: string = "https://iconscout.com/free-lottie-animation/free-owl-animation_12152606";
const reviewPoodleAnimationUrl: string = "https://iconscout.com/free-lottie-animation/free-poodle-animation_12152614";
const reviewWhaleAnimationUrl: string = "https://iconscout.com/free-lottie-animation/free-whale-animation_12152600";
const reviewPeacockAnimationUrl: string = "https://iconscout.com/free-lottie-animation/free-peacock-animation_12152610";
const reviewSnailAnimationUrl: string = "https://iconscout.com/free-lottie-animation/free-snail-animation_12152626";
const reviewRainbowAnimationUrl: string = "https://iconscout.com/free-lottie-animation/free-rainbow-animation_12152617";
const reviewUnicornAnimationUrl: string = "https://iconscout.com/free-lottie-animation/free-unicorn-animation_12152598";
const reviewWormAnimationUrl: string = "https://iconscout.com/free-lottie-animation/free-worm-animation_12152603";
const creativeCommonsAttributionUrl: string = "https://creativecommons.org/licenses/by/4.0/";

export function OpenSourceSettingsScreen(): ReactElement {
  const { t } = useI18n();

  return (
    <SettingsShell
      title={t("openSourceSettings.title")}
      subtitle={t("openSourceSettings.subtitle")}
      activeTab="account"
    >
      <div className="settings-nav-list">
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("openSourceSettings.labels.stack")}</span>
          <p className="subtitle">{t("openSourceSettings.stackDescription")}</p>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("openSourceSettings.labels.repository")}</span>
          <a className="ghost-btn" href={repositoryUrl} rel="noreferrer" target="_blank">
            {t("openSourceSettings.repositoryAction")}
          </a>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("openSourceSettings.labels.selfHosting")}</span>
          <p className="subtitle">{t("openSourceSettings.selfHostingDescription")}</p>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("openSourceSettings.labels.notices")}</span>
          <p className="subtitle">{t("openSourceSettings.thirdPartyNoticeDescription")}</p>
          <a className="ghost-btn" href={thirdPartyNoticesUrl} rel="noreferrer" target="_blank">
            {t("openSourceSettings.thirdPartyNoticeFullAction")}
          </a>
          <a className="ghost-btn" href={reviewOwlAnimationUrl} rel="noreferrer" target="_blank">
            {t("openSourceSettings.thirdPartyNoticeOwlSourceAction")}
          </a>
          <a className="ghost-btn" href={reviewPoodleAnimationUrl} rel="noreferrer" target="_blank">
            {t("openSourceSettings.thirdPartyNoticePoodleSourceAction")}
          </a>
          <a className="ghost-btn" href={reviewWhaleAnimationUrl} rel="noreferrer" target="_blank">
            {t("openSourceSettings.thirdPartyNoticeWhaleSourceAction")}
          </a>
          <a className="ghost-btn" href={reviewPeacockAnimationUrl} rel="noreferrer" target="_blank">
            {t("openSourceSettings.thirdPartyNoticePeacockSourceAction")}
          </a>
          <a className="ghost-btn" href={reviewUnicornAnimationUrl} rel="noreferrer" target="_blank">
            {t("openSourceSettings.thirdPartyNoticeUnicornSourceAction")}
          </a>
          <a className="ghost-btn" href={reviewSnailAnimationUrl} rel="noreferrer" target="_blank">
            {t("openSourceSettings.thirdPartyNoticeSnailSourceAction")}
          </a>
          <a className="ghost-btn" href={reviewRainbowAnimationUrl} rel="noreferrer" target="_blank">
            {t("openSourceSettings.thirdPartyNoticeRainbowSourceAction")}
          </a>
          <a className="ghost-btn" href={reviewWormAnimationUrl} rel="noreferrer" target="_blank">
            {t("openSourceSettings.thirdPartyNoticeWormSourceAction")}
          </a>
          <a className="ghost-btn" href={creativeCommonsAttributionUrl} rel="noreferrer" target="_blank">
            {t("openSourceSettings.thirdPartyNoticeLicenseAction")}
          </a>
        </article>
      </div>
    </SettingsShell>
  );
}
