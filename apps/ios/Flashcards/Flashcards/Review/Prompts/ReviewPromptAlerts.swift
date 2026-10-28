import SwiftUI

private let reviewCardsStringsTableName: String = "ReviewCards"

/// The after-review prompt alerts, shared by their real hosts and the Settings → Test previews; the
/// caller owns every effect of the buttons.
extension View {
    /// `.notRequested` continues to the OS permission dialog; any other status to system Settings.
    func reviewNotificationPrePromptAlert(
        isPresented: Binding<Bool>,
        permissionStatus: ReviewNotificationPermissionStatus,
        onNotNow: @escaping () -> Void,
        onContinue: @escaping () -> Void
    ) -> some View {
        self.alert(
            String(localized: "Stay on top of your cards", table: reviewCardsStringsTableName),
            isPresented: isPresented
        ) {
            Button(String(localized: "Not now", table: reviewCardsStringsTableName), role: .cancel, action: onNotNow)
            Button(
                permissionStatus == .notRequested
                    ? String(localized: "Continue", table: reviewCardsStringsTableName)
                    : String(
                        localized: "shared.action.open_settings",
                        table: "Foundation",
                        comment: "Permission action title to open Settings"
                    ),
                action: onContinue
            )
        } message: {
            Text(String(localized: "Nibomo can send study reminders with a card from your review queue. These notifications contain study cards only and never marketing messages.", table: reviewCardsStringsTableName))
        }
    }

    func reviewHardReminderAlert(isPresented: Binding<Bool>, onOK: @escaping () -> Void) -> some View {
        self.alert(
            String(localized: "Hard is for difficult recall", table: reviewCardsStringsTableName),
            isPresented: isPresented
        ) {
            Button(String(localized: "OK", table: reviewCardsStringsTableName), role: .cancel, action: onOK)
        } message: {
            Text(String(localized: "If you did not know the answer, choose \"Again\". \"Hard\" is only for answers you knew but it was difficult to recall.", table: reviewCardsStringsTableName))
        }
    }

    func guestSignInAfterReviewPromptAlert(
        isPresented: Binding<Bool>,
        onLater: @escaping () -> Void,
        onSignIn: @escaping () -> Void
    ) -> some View {
        self.alert(
            String(
                localized: "root_tab.guest_sign_in_after_review_prompt.title",
                defaultValue: "Save your progress",
                table: "Foundation",
                comment: "Guest sign-in prompt title after reviewing enough cards"
            ),
            isPresented: isPresented
        ) {
            Button(
                String(
                    localized: "root_tab.guest_sign_in_after_review_prompt.later",
                    defaultValue: "Later",
                    table: "Foundation",
                    comment: "Guest sign-in prompt secondary button"
                ),
                role: .cancel,
                action: onLater
            )
            Button(
                String(
                    localized: "root_tab.guest_sign_in_after_review_prompt.sign_in",
                    defaultValue: "Sign in",
                    table: "Foundation",
                    comment: "Guest sign-in prompt primary button"
                ),
                action: onSignIn
            )
        } message: {
            Text(
                String(
                    localized: "root_tab.guest_sign_in_after_review_prompt.message",
                    defaultValue: "Sign in with email so these cards and review progress are not lost.",
                    table: "Foundation",
                    comment: "Guest sign-in prompt body after reviewing enough cards"
                )
            )
        }
    }
}
