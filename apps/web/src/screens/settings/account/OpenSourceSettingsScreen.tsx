import type { ReactElement } from "react";
import { useI18n } from "../../../i18n";
import { SettingsShell } from "../SettingsShared";

const repositoryUrl: string = "https://github.com/kirill-markin/flashcards-open-source-app";
const thirdPartyNoticesUrl: string = "https://github.com/kirill-markin/flashcards-open-source-app/blob/main/THIRD_PARTY_NOTICES.md";
const creativeCommonsAttributionUrl: string = "https://creativecommons.org/licenses/by/4.0/";

const reviewAnimationSourceLinks = [
  { actionKey: "openSourceSettings.thirdPartyNoticeRainCloudSourceAction", url: "https://iconscout.com/free-lottie-animation/free-rain-cloud-animation_12152618" },
  { actionKey: "openSourceSettings.thirdPartyNoticeTornadoSourceAction", url: "https://iconscout.com/free-lottie-animation/free-tornado-animation_12152595" },
  { actionKey: "openSourceSettings.thirdPartyNoticeWindFaceSourceAction", url: "https://iconscout.com/free-lottie-animation/free-wind-face-animation_12152602" },
  { actionKey: "openSourceSettings.thirdPartyNoticeSnowflakeSourceAction", url: "https://iconscout.com/free-lottie-animation/free-snowflake-animation_12152628" },
  { actionKey: "openSourceSettings.thirdPartyNoticeSnailSourceAction", url: "https://iconscout.com/free-lottie-animation/free-snail-animation_12152626" },
  { actionKey: "openSourceSettings.thirdPartyNoticeTurtleSourceAction", url: "https://iconscout.com/free-lottie-animation/free-turtle-animation_12152597" },
  { actionKey: "openSourceSettings.thirdPartyNoticeWiltedFlowerSourceAction", url: "https://iconscout.com/free-lottie-animation/free-wilted-flower-animation_12152601" },
  { actionKey: "openSourceSettings.thirdPartyNoticeSpiderSourceAction", url: "https://iconscout.com/free-lottie-animation/free-spider-animation_12152629" },
  { actionKey: "openSourceSettings.thirdPartyNoticeRatSourceAction", url: "https://iconscout.com/free-lottie-animation/free-rat-animation_12152619" },
  { actionKey: "openSourceSettings.thirdPartyNoticeWormSourceAction", url: "https://iconscout.com/free-lottie-animation/free-worm-animation_12152603" },
  { actionKey: "openSourceSettings.thirdPartyNoticeTigerSourceAction", url: "https://iconscout.com/free-lottie-animation/free-tiger-animation_12152594" },
  { actionKey: "openSourceSettings.thirdPartyNoticeTRexSourceAction", url: "https://iconscout.com/free-lottie-animation/free-t-rex-animation_12152596" },
  { actionKey: "openSourceSettings.thirdPartyNoticeSharkSourceAction", url: "https://iconscout.com/free-lottie-animation/free-shark-animation_12152625" },
  { actionKey: "openSourceSettings.thirdPartyNoticeOxSourceAction", url: "https://iconscout.com/free-lottie-animation/free-ox-animation_12152607" },
  { actionKey: "openSourceSettings.thirdPartyNoticeRacehorseSourceAction", url: "https://iconscout.com/free-lottie-animation/free-racehorse-animation_12152616" },
  { actionKey: "openSourceSettings.thirdPartyNoticeSnakeSourceAction", url: "https://iconscout.com/free-lottie-animation/free-snake-animation_12152627" },
  { actionKey: "openSourceSettings.thirdPartyNoticeVolcanoSourceAction", url: "https://iconscout.com/free-lottie-animation/free-volcano-animation_12152599" },
  { actionKey: "openSourceSettings.thirdPartyNoticeScorpionSourceAction", url: "https://iconscout.com/free-lottie-animation/free-scorpion-animation_12152622" },
  { actionKey: "openSourceSettings.thirdPartyNoticePawPrintsSourceAction", url: "https://iconscout.com/free-lottie-animation/free-paw-prints-animation_12152608" },
  { actionKey: "openSourceSettings.thirdPartyNoticeRoosterSourceAction", url: "https://iconscout.com/free-lottie-animation/free-rooster-animation_12152620" },
  { actionKey: "openSourceSettings.thirdPartyNoticeOtterSourceAction", url: "https://iconscout.com/free-lottie-animation/free-otter-animation_12152605" },
  { actionKey: "openSourceSettings.thirdPartyNoticeOwlSourceAction", url: "https://iconscout.com/free-lottie-animation/free-owl-animation_12152606" },
  { actionKey: "openSourceSettings.thirdPartyNoticeRabbitSourceAction", url: "https://iconscout.com/free-lottie-animation/free-rabbit-animation_12152615" },
  { actionKey: "openSourceSettings.thirdPartyNoticeSealSourceAction", url: "https://iconscout.com/free-lottie-animation/free-seal-animation_12152623" },
  { actionKey: "openSourceSettings.thirdPartyNoticeServiceDogSourceAction", url: "https://iconscout.com/free-lottie-animation/free-service-dog-animation_12152624" },
  { actionKey: "openSourceSettings.thirdPartyNoticePoodleSourceAction", url: "https://iconscout.com/free-lottie-animation/free-poodle-animation_12152614" },
  { actionKey: "openSourceSettings.thirdPartyNoticeChimpanzeeSourceAction", url: "https://iconscout.com/free-lottie-animation/free-chimpanzee-animation_12152604" },
  { actionKey: "openSourceSettings.thirdPartyNoticeWhaleSourceAction", url: "https://iconscout.com/free-lottie-animation/free-whale-animation_12152600" },
  { actionKey: "openSourceSettings.thirdPartyNoticePeacockSourceAction", url: "https://iconscout.com/free-lottie-animation/free-peacock-animation_12152610" },
  { actionKey: "openSourceSettings.thirdPartyNoticePigSourceAction", url: "https://iconscout.com/free-lottie-animation/free-pig-animation_12152612" },
  { actionKey: "openSourceSettings.thirdPartyNoticeSunriseSourceAction", url: "https://iconscout.com/free-lottie-animation/free-sunrise-animation_12152630" },
  { actionKey: "openSourceSettings.thirdPartyNoticeSunriseOverMountainsSourceAction", url: "https://iconscout.com/free-lottie-animation/free-sunrise-over-mountains-animation_12152631" },
  { actionKey: "openSourceSettings.thirdPartyNoticeRoseSourceAction", url: "https://iconscout.com/free-lottie-animation/free-rose-animation_12152621" },
  { actionKey: "openSourceSettings.thirdPartyNoticePeaceSourceAction", url: "https://iconscout.com/free-lottie-animation/free-peace-animation_12152609" },
  { actionKey: "openSourceSettings.thirdPartyNoticePlantSourceAction", url: "https://iconscout.com/free-lottie-animation/free-plant-animation_12152613" },
  { actionKey: "openSourceSettings.thirdPartyNoticeRainbowSourceAction", url: "https://iconscout.com/free-lottie-animation/free-rainbow-animation_12152617" },
  { actionKey: "openSourceSettings.thirdPartyNoticePhoenixSourceAction", url: "https://iconscout.com/free-lottie-animation/free-phoenix-animation_12152611" },
  { actionKey: "openSourceSettings.thirdPartyNoticeUnicornSourceAction", url: "https://iconscout.com/free-lottie-animation/free-unicorn-animation_12152598" },
] as const;

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
          {reviewAnimationSourceLinks.map((sourceLink) => (
            <a className="ghost-btn" href={sourceLink.url} key={sourceLink.url} rel="noreferrer" target="_blank">
              {t(sourceLink.actionKey)}
            </a>
          ))}
          <a className="ghost-btn" href={creativeCommonsAttributionUrl} rel="noreferrer" target="_blank">
            {t("openSourceSettings.thirdPartyNoticeLicenseAction")}
          </a>
        </article>
      </div>
    </SettingsShell>
  );
}
