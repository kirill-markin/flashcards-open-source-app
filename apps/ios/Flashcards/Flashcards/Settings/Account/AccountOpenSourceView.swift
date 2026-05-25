import SwiftUI

private let thirdPartyNoticesUrl: String = "https://github.com/kirill-markin/flashcards-open-source-app/blob/main/THIRD_PARTY_NOTICES.md"
private let reviewOwlAnimationUrl: String = "https://iconscout.com/free-lottie-animation/free-owl-animation_12152606"
private let reviewPoodleAnimationUrl: String = "https://iconscout.com/free-lottie-animation/free-poodle-animation_12152614"
private let reviewWhaleAnimationUrl: String = "https://iconscout.com/free-lottie-animation/free-whale-animation_12152600"
private let reviewPeacockAnimationUrl: String = "https://iconscout.com/free-lottie-animation/free-peacock-animation_12152610"
private let reviewSnailAnimationUrl: String = "https://iconscout.com/free-lottie-animation/free-snail-animation_12152626"
private let reviewRainbowAnimationUrl: String = "https://iconscout.com/free-lottie-animation/free-rainbow-animation_12152617"
private let reviewUnicornAnimationUrl: String = "https://iconscout.com/free-lottie-animation/free-unicorn-animation_12152598"
private let reviewWormAnimationUrl: String = "https://iconscout.com/free-lottie-animation/free-worm-animation_12152603"
private let creativeCommonsAttributionUrl: String = "https://creativecommons.org/licenses/by/4.0/"

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
                        "Review Lottie animations: Free Owl Animation, Free Poodle Animation, Free Whale Animation, Free Peacock Animation, Free Unicorn Animation, Free Snail Animation, Free Rainbow Animation, and Free Worm Animation by Google Inc., Copyright © 2026 Google Inc., used under Creative Commons Attribution 4.0. Lottie runtimes use MIT and Apache 2.0 licenses."
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

                if let assetUrl = URL(string: reviewOwlAnimationUrl) {
                    Link(destination: assetUrl) {
                        SettingsNavigationRow(
                            title: aiSettingsLocalized("settings.account.openSource.thirdPartyNoticeOwlSource", "Owl Asset Source"),
                            value: aiSettingsLocalized("common.open", "Open"),
                            systemImage: "arrow.up.forward.square"
                        )
                    }
                }

                if let assetUrl = URL(string: reviewPoodleAnimationUrl) {
                    Link(destination: assetUrl) {
                        SettingsNavigationRow(
                            title: aiSettingsLocalized("settings.account.openSource.thirdPartyNoticePoodleSource", "Poodle Asset Source"),
                            value: aiSettingsLocalized("common.open", "Open"),
                            systemImage: "arrow.up.forward.square"
                        )
                    }
                }

                if let assetUrl = URL(string: reviewWhaleAnimationUrl) {
                    Link(destination: assetUrl) {
                        SettingsNavigationRow(
                            title: aiSettingsLocalized("settings.account.openSource.thirdPartyNoticeWhaleSource", "Whale Asset Source"),
                            value: aiSettingsLocalized("common.open", "Open"),
                            systemImage: "arrow.up.forward.square"
                        )
                    }
                }

                if let assetUrl = URL(string: reviewPeacockAnimationUrl) {
                    Link(destination: assetUrl) {
                        SettingsNavigationRow(
                            title: aiSettingsLocalized("settings.account.openSource.thirdPartyNoticePeacockSource", "Peacock Asset Source"),
                            value: aiSettingsLocalized("common.open", "Open"),
                            systemImage: "arrow.up.forward.square"
                        )
                    }
                }

                if let assetUrl = URL(string: reviewUnicornAnimationUrl) {
                    Link(destination: assetUrl) {
                        SettingsNavigationRow(
                            title: aiSettingsLocalized("settings.account.openSource.thirdPartyNoticeUnicornSource", "Unicorn Asset Source"),
                            value: aiSettingsLocalized("common.open", "Open"),
                            systemImage: "arrow.up.forward.square"
                        )
                    }
                }

                if let assetUrl = URL(string: reviewSnailAnimationUrl) {
                    Link(destination: assetUrl) {
                        SettingsNavigationRow(
                            title: aiSettingsLocalized("settings.account.openSource.thirdPartyNoticeSnailSource", "Snail Asset Source"),
                            value: aiSettingsLocalized("common.open", "Open"),
                            systemImage: "arrow.up.forward.square"
                        )
                    }
                }

                if let assetUrl = URL(string: reviewRainbowAnimationUrl) {
                    Link(destination: assetUrl) {
                        SettingsNavigationRow(
                            title: aiSettingsLocalized("settings.account.openSource.thirdPartyNoticeRainbowSource", "Rainbow Asset Source"),
                            value: aiSettingsLocalized("common.open", "Open"),
                            systemImage: "arrow.up.forward.square"
                        )
                    }
                }

                if let assetUrl = URL(string: reviewWormAnimationUrl) {
                    Link(destination: assetUrl) {
                        SettingsNavigationRow(
                            title: aiSettingsLocalized("settings.account.openSource.thirdPartyNoticeWormSource", "Worm Asset Source"),
                            value: aiSettingsLocalized("common.open", "Open"),
                            systemImage: "arrow.up.forward.square"
                        )
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
