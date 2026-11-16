#if !targetEnvironment(macCatalyst)
import Foundation
import WidgetKit

// The widget extension is embedded only in the iOS and iPadOS build, so Mac Catalyst has nothing to report.

/// Holds only the Review kind, in its original shape, so upgrading installations do not report Review again.
private let lastReportedWidgetPlacementUserDefaultsKey: String = "last-reported-widget-placement-v1"
/// Every kind except Review, keyed by `AnalyticsWidgetKind` raw value.
private let lastReportedWidgetPlacementByKindUserDefaultsKey: String = "last-reported-widget-placement-by-kind-v1"

/// The `kind` each widget in `FlashcardsWidget` declares; the app target cannot see those constants.
private let analyticsWidgetKindsByWidgetKitKind: [String: AnalyticsWidgetKind] = [
    reviewWidgetKind: .review,
    "ActivityWidget": .activity,
    "YearWidget": .year,
    "TodayWidget": .today,
    "LockScreenWidget": .lockScreen,
    "ReviewsChartWidget": .reviewsChart,
    "StreaksWidget": .streaks,
    "MonthCalendarWidget": .monthCalendar,
    "ComingUpWidget": .comingUp,
    "DashboardWidget": .dashboard,
    "QuestionWidget": .question,
]

private struct ReviewWidgetPlacementCounts: Codable, Hashable {
    let smallCount: Int
    let mediumCount: Int
    let largeCount: Int
}

private struct WidgetPlacementCounts: Codable, Hashable {
    let smallCount: Int
    let mediumCount: Int
    let largeCount: Int
    let accessoryCircularCount: Int
    let accessoryRectangularCount: Int
    let accessoryInlineCount: Int
}

private let emptyWidgetPlacementCounts = WidgetPlacementCounts(
    smallCount: 0,
    mediumCount: 0,
    largeCount: 0,
    accessoryCircularCount: 0,
    accessoryRectangularCount: 0,
    accessoryInlineCount: 0
)

private struct UnknownWidgetKindError: LocalizedError {
    let widgetKitKind: String

    var errorDescription: String? {
        "Placed widget kind \"\(widgetKitKind)\" has no analytics widget kind; add it to analyticsWidgetKindsByWidgetKitKind."
    }
}

@MainActor
extension FlashcardsStore {
    /// Reports one `widget_placement_changed` per widget kind whose placed counts differ from the last report of
    /// that kind on this installation. Review also reports when it was never reported; any other kind never
    /// reported counts as all zeros.
    func reportWidgetPlacementIfChanged() async {
        let configurations: [WidgetInfo]
        do {
            configurations = try await WidgetCenter.shared.currentConfigurations()
        } catch is CancellationError {
            return
        } catch {
            self.captureWidgetFailure(error: error, workspaceId: self.workspace?.workspaceId, action: "widget_placement_read")
            return
        }

        // Compared and stored without a suspension point, so scenes foregrounded together report one change once.
        var familiesByKind: [AnalyticsWidgetKind: [WidgetFamily]] = [:]
        var unknownWidgetKitKinds: Set<String> = []
        for configuration in configurations {
            guard let kind = analyticsWidgetKindsByWidgetKitKind[configuration.kind] else {
                unknownWidgetKitKinds.insert(configuration.kind)
                continue
            }
            familiesByKind[kind, default: []].append(configuration.family)
        }
        for widgetKitKind in unknownWidgetKitKinds.sorted() {
            self.captureWidgetFailure(
                error: UnknownWidgetKindError(widgetKitKind: widgetKitKind),
                workspaceId: self.workspace?.workspaceId,
                action: "widget_placement_kind"
            )
        }

        let lastReviewCounts = self.loadLastReportedReviewWidgetPlacement()
        let lastCountsByKind = self.loadLastReportedWidgetPlacementByKind()
        var nextReviewCounts: ReviewWidgetPlacementCounts? = nil
        var nextCountsByKind = lastCountsByKind
        var changedKinds: [(kind: AnalyticsWidgetKind, counts: WidgetPlacementCounts)] = []
        for kind in AnalyticsWidgetKind.allCases {
            let counts = makeWidgetPlacementCounts(families: familiesByKind[kind, default: []])
            if kind == .review {
                let reviewCounts = makeReviewWidgetPlacementCounts(counts: counts)
                guard reviewCounts != lastReviewCounts else {
                    continue
                }
                nextReviewCounts = reviewCounts
            } else {
                guard counts != lastCountsByKind[kind.rawValue, default: emptyWidgetPlacementCounts] else {
                    continue
                }
                nextCountsByKind[kind.rawValue] = counts
            }
            changedKinds.append((kind: kind, counts: counts))
        }
        guard changedKinds.isEmpty == false else {
            return
        }

        let reviewData: Data?
        let byKindData: Data
        do {
            reviewData = try nextReviewCounts.map { counts in try self.encoder.encode(counts) }
            byKindData = try self.encoder.encode(nextCountsByKind)
        } catch {
            self.captureWidgetFailure(error: error, workspaceId: self.workspace?.workspaceId, action: "widget_placement_save")
            return
        }
        if let reviewData {
            self.userDefaults.set(reviewData, forKey: lastReportedWidgetPlacementUserDefaultsKey)
        }
        self.userDefaults.set(byKindData, forKey: lastReportedWidgetPlacementByKindUserDefaultsKey)
        for changed in changedKinds {
            Analytics.track(makeWidgetPlacementChangedEvent(kind: changed.kind, counts: changed.counts))
        }
    }

    /// The next identity gets its own first report.
    func clearLastReportedWidgetPlacementForCloudIdentityReset() {
        self.userDefaults.removeObject(forKey: lastReportedWidgetPlacementUserDefaultsKey)
        self.userDefaults.removeObject(forKey: lastReportedWidgetPlacementByKindUserDefaultsKey)
    }

    private func loadLastReportedReviewWidgetPlacement() -> ReviewWidgetPlacementCounts? {
        guard let data = self.userDefaults.data(forKey: lastReportedWidgetPlacementUserDefaultsKey) else {
            return nil
        }

        do {
            return try self.decoder.decode(ReviewWidgetPlacementCounts.self, from: data)
        } catch {
            self.captureWidgetFailure(error: error, workspaceId: self.workspace?.workspaceId, action: "widget_placement_load")
            self.userDefaults.removeObject(forKey: lastReportedWidgetPlacementUserDefaultsKey)
            return nil
        }
    }

    private func loadLastReportedWidgetPlacementByKind() -> [String: WidgetPlacementCounts] {
        guard let data = self.userDefaults.data(forKey: lastReportedWidgetPlacementByKindUserDefaultsKey) else {
            return [:]
        }

        do {
            return try self.decoder.decode([String: WidgetPlacementCounts].self, from: data)
        } catch {
            self.captureWidgetFailure(error: error, workspaceId: self.workspace?.workspaceId, action: "widget_placement_load")
            self.userDefaults.removeObject(forKey: lastReportedWidgetPlacementByKindUserDefaultsKey)
            return [:]
        }
    }
}

private func makeWidgetPlacementCounts(families: [WidgetFamily]) -> WidgetPlacementCounts {
    WidgetPlacementCounts(
        smallCount: families.filter { family in family == .systemSmall }.count,
        mediumCount: families.filter { family in family == .systemMedium }.count,
        largeCount: families.filter { family in family == .systemLarge }.count,
        accessoryCircularCount: families.filter { family in family == .accessoryCircular }.count,
        accessoryRectangularCount: families.filter { family in family == .accessoryRectangular }.count,
        accessoryInlineCount: families.filter { family in family == .accessoryInline }.count
    )
}

/// The Review widget offers no accessory family, so its stored state keeps only the Home Screen sizes.
private func makeReviewWidgetPlacementCounts(counts: WidgetPlacementCounts) -> ReviewWidgetPlacementCounts {
    ReviewWidgetPlacementCounts(
        smallCount: counts.smallCount,
        mediumCount: counts.mediumCount,
        largeCount: counts.largeCount
    )
}

private func makeWidgetPlacementChangedEvent(kind: AnalyticsWidgetKind, counts: WidgetPlacementCounts) -> AnalyticsEvent {
    let accessoryCounts: AnalyticsWidgetAccessoryCounts? = kind == .lockScreen
        ? AnalyticsWidgetAccessoryCounts(
            circularCount: counts.accessoryCircularCount,
            rectangularCount: counts.accessoryRectangularCount,
            inlineCount: counts.accessoryInlineCount
        )
        : nil
    return .widgetPlacementChanged(
        widgetKind: kind,
        smallCount: counts.smallCount,
        mediumCount: counts.mediumCount,
        largeCount: counts.largeCount,
        accessoryCounts: accessoryCounts
    )
}
#endif
