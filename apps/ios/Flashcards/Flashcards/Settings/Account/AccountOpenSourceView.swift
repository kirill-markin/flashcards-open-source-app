import SwiftUI

private let thirdPartyNoticesUrl: String = "https://github.com/kirill-markin/flashcards-open-source-app/blob/main/THIRD_PARTY_NOTICES.md"
private let creativeCommonsAttributionUrl: String = "https://creativecommons.org/licenses/by/4.0/"

private struct ReviewAnimationSourceLink: Identifiable {
    let url: String
    let localizationKey: String
    let fallbackTitle: String

    var id: String {
        self.url
    }
}

private let reviewAnimationSourceLinks: [ReviewAnimationSourceLink] = [
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-rain-cloud-animation_12152618",
        localizationKey: "settings.account.openSource.thirdPartyNoticeRainCloudSource",
        fallbackTitle: "Rain Cloud Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-tornado-animation_12152595",
        localizationKey: "settings.account.openSource.thirdPartyNoticeTornadoSource",
        fallbackTitle: "Tornado Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-wind-face-animation_12152602",
        localizationKey: "settings.account.openSource.thirdPartyNoticeWindFaceSource",
        fallbackTitle: "Wind Face Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-snowflake-animation_12152628",
        localizationKey: "settings.account.openSource.thirdPartyNoticeSnowflakeSource",
        fallbackTitle: "Snowflake Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-snail-animation_12152626",
        localizationKey: "settings.account.openSource.thirdPartyNoticeSnailSource",
        fallbackTitle: "Snail Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-turtle-animation_12152597",
        localizationKey: "settings.account.openSource.thirdPartyNoticeTurtleSource",
        fallbackTitle: "Turtle Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-wilted-flower-animation_12152601",
        localizationKey: "settings.account.openSource.thirdPartyNoticeWiltedFlowerSource",
        fallbackTitle: "Wilted Flower Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-spider-animation_12152629",
        localizationKey: "settings.account.openSource.thirdPartyNoticeSpiderSource",
        fallbackTitle: "Spider Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-rat-animation_12152619",
        localizationKey: "settings.account.openSource.thirdPartyNoticeRatSource",
        fallbackTitle: "Rat Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-worm-animation_12152603",
        localizationKey: "settings.account.openSource.thirdPartyNoticeWormSource",
        fallbackTitle: "Worm Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-tiger-animation_12152594",
        localizationKey: "settings.account.openSource.thirdPartyNoticeTigerSource",
        fallbackTitle: "Tiger Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-t-rex-animation_12152596",
        localizationKey: "settings.account.openSource.thirdPartyNoticeTRexSource",
        fallbackTitle: "T Rex Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-shark-animation_12152625",
        localizationKey: "settings.account.openSource.thirdPartyNoticeSharkSource",
        fallbackTitle: "Shark Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-ox-animation_12152607",
        localizationKey: "settings.account.openSource.thirdPartyNoticeOxSource",
        fallbackTitle: "Ox Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-racehorse-animation_12152616",
        localizationKey: "settings.account.openSource.thirdPartyNoticeRacehorseSource",
        fallbackTitle: "Racehorse Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-snake-animation_12152627",
        localizationKey: "settings.account.openSource.thirdPartyNoticeSnakeSource",
        fallbackTitle: "Snake Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-volcano-animation_12152599",
        localizationKey: "settings.account.openSource.thirdPartyNoticeVolcanoSource",
        fallbackTitle: "Volcano Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-scorpion-animation_12152622",
        localizationKey: "settings.account.openSource.thirdPartyNoticeScorpionSource",
        fallbackTitle: "Scorpion Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-paw-prints-animation_12152608",
        localizationKey: "settings.account.openSource.thirdPartyNoticePawPrintsSource",
        fallbackTitle: "Paw Prints Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-rooster-animation_12152620",
        localizationKey: "settings.account.openSource.thirdPartyNoticeRoosterSource",
        fallbackTitle: "Rooster Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-otter-animation_12152605",
        localizationKey: "settings.account.openSource.thirdPartyNoticeOtterSource",
        fallbackTitle: "Otter Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-owl-animation_12152606",
        localizationKey: "settings.account.openSource.thirdPartyNoticeOwlSource",
        fallbackTitle: "Owl Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-rabbit-animation_12152615",
        localizationKey: "settings.account.openSource.thirdPartyNoticeRabbitSource",
        fallbackTitle: "Rabbit Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-seal-animation_12152623",
        localizationKey: "settings.account.openSource.thirdPartyNoticeSealSource",
        fallbackTitle: "Seal Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-service-dog-animation_12152624",
        localizationKey: "settings.account.openSource.thirdPartyNoticeServiceDogSource",
        fallbackTitle: "Service Dog Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-poodle-animation_12152614",
        localizationKey: "settings.account.openSource.thirdPartyNoticePoodleSource",
        fallbackTitle: "Poodle Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-chimpanzee-animation_12152604",
        localizationKey: "settings.account.openSource.thirdPartyNoticeChimpanzeeSource",
        fallbackTitle: "Chimpanzee Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-whale-animation_12152600",
        localizationKey: "settings.account.openSource.thirdPartyNoticeWhaleSource",
        fallbackTitle: "Whale Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-peacock-animation_12152610",
        localizationKey: "settings.account.openSource.thirdPartyNoticePeacockSource",
        fallbackTitle: "Peacock Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-pig-animation_12152612",
        localizationKey: "settings.account.openSource.thirdPartyNoticePigSource",
        fallbackTitle: "Pig Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-sunrise-animation_12152630",
        localizationKey: "settings.account.openSource.thirdPartyNoticeSunriseSource",
        fallbackTitle: "Sunrise Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-sunrise-over-mountains-animation_12152631",
        localizationKey: "settings.account.openSource.thirdPartyNoticeSunriseOverMountainsSource",
        fallbackTitle: "Sunrise Over Mountains Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-rose-animation_12152621",
        localizationKey: "settings.account.openSource.thirdPartyNoticeRoseSource",
        fallbackTitle: "Rose Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-peace-animation_12152609",
        localizationKey: "settings.account.openSource.thirdPartyNoticePeaceSource",
        fallbackTitle: "Peace Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-plant-animation_12152613",
        localizationKey: "settings.account.openSource.thirdPartyNoticePlantSource",
        fallbackTitle: "Plant Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-rainbow-animation_12152617",
        localizationKey: "settings.account.openSource.thirdPartyNoticeRainbowSource",
        fallbackTitle: "Rainbow Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-phoenix-animation_12152611",
        localizationKey: "settings.account.openSource.thirdPartyNoticePhoenixSource",
        fallbackTitle: "Phoenix Asset Source"
    ),
    ReviewAnimationSourceLink(
        url: "https://iconscout.com/free-lottie-animation/free-unicorn-animation_12152598",
        localizationKey: "settings.account.openSource.thirdPartyNoticeUnicornSource",
        fallbackTitle: "Unicorn Asset Source"
    )
]


struct AccountOpenSourceView: View {
    var body: some View {
        List {
            Section(aiSettingsLocalized("settings.account.openSource.section.openSource", "Open Source")) {
                Text(
                    aiSettingsLocalized(
                        "settings.account.openSource.description",
                        "The iOS app and the backend are fully open source. You can inspect the code, use the MIT license, and run the full stack on your own servers."
                    )
                )
                    .foregroundStyle(.secondary)
            }

            Section(aiSettingsLocalized("settings.account.openSource.section.links", "Links")) {
                if let repositoryUrl = URL(string: flashcardsRepositoryUrl) {
                    Link(destination: repositoryUrl) {
                        SettingsNavigationRow(
                            title: aiSettingsLocalized("settings.account.openSource.repository", "GitHub Repository (MIT License)"),
                            value: aiSettingsLocalized("common.open", "Open"),
                            systemImage: "arrow.up.forward.square"
                        )
                    }
                }
            }

            Section(aiSettingsLocalized("settings.account.openSource.section.selfHosting", "Self-Hosting")) {
                Text(
                    aiSettingsLocalized(
                        "settings.account.openSource.selfHosting",
                        "If you need your own backend, you can deploy the same open-source stack yourself and point the iOS app to your domain from Advanced > Server."
                    )
                )
                    .foregroundStyle(.secondary)
            }

            Section(aiSettingsLocalized("settings.account.openSource.section.thirdPartyNotices", "Third-Party Notices")) {
                Text(
                    aiSettingsLocalized(
                        "settings.account.openSource.thirdPartyNotice",
                        "Review Lottie animations: 38 animal and nature animations by Google Inc., Copyright © 2026 Google Inc., used under Creative Commons Attribution 4.0. Lottie runtimes use MIT and Apache 2.0 licenses."
                    )
                )
                    .foregroundStyle(.secondary)

                if let noticesUrl = URL(string: thirdPartyNoticesUrl) {
                    Link(destination: noticesUrl) {
                        SettingsNavigationRow(
                            title: aiSettingsLocalized("settings.account.openSource.thirdPartyNoticeFull", "Full Third-Party Notices"),
                            value: aiSettingsLocalized("common.open", "Open"),
                            systemImage: "arrow.up.forward.square"
                        )
                    }
                }

                ForEach(reviewAnimationSourceLinks) { sourceLink in
                    if let assetUrl = URL(string: sourceLink.url) {
                        Link(destination: assetUrl) {
                            SettingsNavigationRow(
                                title: aiSettingsLocalized(sourceLink.localizationKey, sourceLink.fallbackTitle),
                                value: aiSettingsLocalized("common.open", "Open"),
                                systemImage: "arrow.up.forward.square"
                            )
                        }
                    }
                }

                if let licenseUrl = URL(string: creativeCommonsAttributionUrl) {
                    Link(destination: licenseUrl) {
                        SettingsNavigationRow(
                            title: aiSettingsLocalized("settings.account.openSource.thirdPartyNoticeLicense", "Creative Commons Attribution 4.0"),
                            value: aiSettingsLocalized("common.open", "Open"),
                            systemImage: "arrow.up.forward.square"
                        )
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(aiSettingsLocalized("settings.account.openSource.title", "Open Source"))
    }
}

#Preview {
    NavigationStack {
        AccountOpenSourceView()
    }
}
