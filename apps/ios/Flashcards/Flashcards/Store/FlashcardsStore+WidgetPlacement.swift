#if !targetEnvironment(macCatalyst)
import Foundation
import WidgetKit

// The widget extension is embedded only in the iOS and iPadOS build, so Mac Catalyst has nothing to report.

private let lastReportedWidgetPlacementUserDefaultsKey: String = "last-reported-widget-placement-v1"

private struct WidgetPlacementCounts: Codable, Hashable {
    let smallCount: Int
    let mediumCount: Int
    let largeCount: Int
}

@MainActor
extension FlashcardsStore {
    /// Reports `widget_placement_changed` when the placed Review widgets differ from the last report of this
    /// installation, and always when there is no last report.
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
        let counts = makeWidgetPlacementCounts(configurations: configurations)
        guard counts != self.loadLastReportedWidgetPlacement() else {
            return
        }

        let data: Data
        do {
            data = try self.encoder.encode(counts)
        } catch {
            self.captureWidgetFailure(error: error, workspaceId: self.workspace?.workspaceId, action: "widget_placement_save")
            return
        }
        self.userDefaults.set(data, forKey: lastReportedWidgetPlacementUserDefaultsKey)
        Analytics.track(
            .widgetPlacementChanged(
                smallCount: counts.smallCount,
                mediumCount: counts.mediumCount,
                largeCount: counts.largeCount
            )
        )
    }

    /// The next identity gets its own first report.
    func clearLastReportedWidgetPlacementForCloudIdentityReset() {
        self.userDefaults.removeObject(forKey: lastReportedWidgetPlacementUserDefaultsKey)
    }

    private func loadLastReportedWidgetPlacement() -> WidgetPlacementCounts? {
        guard let data = self.userDefaults.data(forKey: lastReportedWidgetPlacementUserDefaultsKey) else {
            return nil
        }

        do {
            return try self.decoder.decode(WidgetPlacementCounts.self, from: data)
        } catch {
            self.captureWidgetFailure(error: error, workspaceId: self.workspace?.workspaceId, action: "widget_placement_load")
            self.userDefaults.removeObject(forKey: lastReportedWidgetPlacementUserDefaultsKey)
            return nil
        }
    }
}

private func makeWidgetPlacementCounts(configurations: [WidgetInfo]) -> WidgetPlacementCounts {
    let families = configurations
        .filter { configuration in configuration.kind == reviewWidgetKind }
        .map(\.family)
    return WidgetPlacementCounts(
        smallCount: families.filter { family in family == .systemSmall }.count,
        mediumCount: families.filter { family in family == .systemMedium }.count,
        largeCount: families.filter { family in family == .systemLarge }.count
    )
}
#endif
