import Foundation
import XCTest
@testable import Flashcards

final class ReviewNotificationSettingsAndScopeTests: ReviewNotificationsTestCase {
    func testDefaultReviewNotificationsSettingsStartEnabled() {
        let settings = makeDefaultReviewNotificationsSettings()

        XCTAssertTrue(settings.isEnabled)
        XCTAssertEqual(settings.selectedMode, .daily)
        XCTAssertEqual(settings.daily.hour, defaultDailyReminderHour)
        XCTAssertEqual(settings.daily.minute, defaultDailyReminderMinute)
    }

    func testLoadReviewNotificationsSettingsDefaultsToEnabledWhenUnset() {
        let suiteName = "ReviewNotificationsSupportTests-\(UUID().uuidString)"
        guard let userDefaults = UserDefaults(suiteName: suiteName) else {
            XCTFail("Expected isolated UserDefaults suite")
            return
        }
        defer {
            userDefaults.removePersistentDomain(forName: suiteName)
        }

        let settings = loadReviewNotificationsSettings(
            userDefaults: userDefaults,
            encoder: JSONEncoder(),
            decoder: JSONDecoder(),
            workspaceId: "workspace-1"
        )

        XCTAssertTrue(settings.isEnabled)
        XCTAssertEqual(settings.selectedMode, .daily)
    }

    func testLoadReviewNotificationsSettingsMigratesCurrentWorkspaceOnce() throws {
        let suiteName = "ReviewNotificationsSupportTests-\(UUID().uuidString)"
        guard let userDefaults = UserDefaults(suiteName: suiteName) else {
            XCTFail("Expected isolated UserDefaults suite")
            return
        }
        defer {
            userDefaults.removePersistentDomain(forName: suiteName)
        }

        let workspaceId = "workspace-1"
        let disabledSettings = ReviewNotificationsSettings(
            isEnabled: false,
            selectedMode: .inactivity,
            daily: DailyReviewNotificationsSettings(
                hour: defaultDailyReminderHour,
                minute: defaultDailyReminderMinute
            ),
            inactivity: InactivityReviewNotificationsSettings(
                windowStartHour: 9,
                windowStartMinute: 0,
                windowEndHour: 19,
                windowEndMinute: 0,
                idleMinutes: 60
            ),
            showAppIconBadge: true
        )

        let persistedData = try JSONEncoder().encode(disabledSettings)
        userDefaults.set(
            persistedData,
            forKey: makeLegacyReviewNotificationsSettingsUserDefaultsKey(workspaceId: workspaceId)
        )

        let loadedSettings = loadReviewNotificationsSettings(
            userDefaults: userDefaults,
            encoder: JSONEncoder(),
            decoder: JSONDecoder(),
            workspaceId: workspaceId
        )

        XCTAssertEqual(loadedSettings, disabledSettings)
        XCTAssertNotNil(userDefaults.data(forKey: reviewNotificationsSettingsUserDefaultsKey))

        let settingsAfterWorkspaceSwitch = loadReviewNotificationsSettings(
            userDefaults: userDefaults,
            encoder: JSONEncoder(),
            decoder: JSONDecoder(),
            workspaceId: "workspace-2"
        )

        XCTAssertEqual(settingsAfterWorkspaceSwitch, disabledSettings)
    }

    func testDefaultStrictRemindersSettingsStartEnabled() {
        let settings = makeDefaultStrictRemindersSettings()

        XCTAssertTrue(settings.isEnabled)
    }

    func testReviewNotificationPendingLimitReservesStrictReminderCapacityWhenEnabled() {
        let settings = StrictRemindersSettings(isEnabled: true)

        XCTAssertEqual(
            reviewNotificationPendingRequestsLimit(strictRemindersSettings: settings),
            appNotificationPendingRequestsLimit - strictReminderPendingRequestsLimit
        )
    }

    func testReviewNotificationPendingLimitUsesFullLimitWhenStrictRemindersDisabled() {
        let settings = StrictRemindersSettings(isEnabled: false)

        XCTAssertEqual(
            reviewNotificationPendingRequestsLimit(strictRemindersSettings: settings),
            appNotificationPendingRequestsLimit
        )
    }

    func testStrictReminderNotificationScopePersistsAndValidatesCurrentNotification() {
        let suiteName = "ReviewNotificationsSupportTests-\(UUID().uuidString)"
        guard let userDefaults = UserDefaults(suiteName: suiteName) else {
            XCTFail("Expected isolated UserDefaults suite")
            return
        }
        defer {
            userDefaults.removePersistentDomain(forName: suiteName)
        }

        let scope = loadStrictReminderNotificationScope(userDefaults: userDefaults)
        let userInfo = buildStrictReminderNotificationUserInfo(scope: scope)

        XCTAssertFalse(scope.isEmpty)
        XCTAssertEqual(loadStrictReminderNotificationScope(userDefaults: userDefaults), scope)
        XCTAssertTrue(isCurrentStrictReminderNotification(userInfo: userInfo, userDefaults: userDefaults))
    }

    func testStrictReminderNotificationScopeRejectsMissingOrRotatedScope() {
        let suiteName = "ReviewNotificationsSupportTests-\(UUID().uuidString)"
        guard let userDefaults = UserDefaults(suiteName: suiteName) else {
            XCTFail("Expected isolated UserDefaults suite")
            return
        }
        defer {
            userDefaults.removePersistentDomain(forName: suiteName)
        }

        let initialScope = loadStrictReminderNotificationScope(userDefaults: userDefaults)
        let initialUserInfo = buildStrictReminderNotificationUserInfo(scope: initialScope)

        XCTAssertFalse(
            isCurrentStrictReminderNotification(
                userInfo: [appNotificationTapTypeUserInfoKey: AppNotificationTapType.strictReminder.rawValue],
                userDefaults: userDefaults
            )
        )

        rotateStrictReminderNotificationScope(userDefaults: userDefaults)

        XCTAssertFalse(isCurrentStrictReminderNotification(userInfo: initialUserInfo, userDefaults: userDefaults))
    }

    func testShouldRemoveStrictReminderNotificationMatchesOnlyLegacyOrCapturedScope() {
        let oldScope = "old-scope"
        let newScope = "new-scope"

        XCTAssertTrue(
            shouldRemoveStrictReminderNotification(
                userInfo: buildStrictReminderNotificationUserInfo(scope: oldScope),
                removalScope: oldScope
            )
        )
        XCTAssertTrue(
            shouldRemoveStrictReminderNotification(
                userInfo: [appNotificationTapTypeUserInfoKey: AppNotificationTapType.strictReminder.rawValue],
                removalScope: oldScope
            )
        )
        XCTAssertFalse(
            shouldRemoveStrictReminderNotification(
                userInfo: buildStrictReminderNotificationUserInfo(scope: newScope),
                removalScope: oldScope
            )
        )
        XCTAssertFalse(
            shouldRemoveStrictReminderNotification(
                userInfo: [appNotificationTapTypeUserInfoKey: AppNotificationTapType.reviewReminder.rawValue],
                removalScope: oldScope
            )
        )
    }

    func testStrictReminderRemovalScopesRemoveCurrentScopeAndLegacyPayloads() {
        XCTAssertEqual(
            strictReminderRemovalScopes(currentScope: "current-scope"),
            ["current-scope", nil]
        )
        XCTAssertEqual(
            strictReminderRemovalScopes(currentScope: nil),
            [nil]
        )
        XCTAssertEqual(
            strictReminderRemovalScopes(currentScope: ""),
            [nil]
        )
    }
}
