import SwiftUI
import WidgetKit

/// Shown by every Home Screen widget before the app has written a snapshot; it invites the user to open the app.
struct WidgetNoSnapshotView: View {
    @Environment(\.widgetAccent) private var accent
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: "rectangle.stack.fill")
                .font(.title2)
                .foregroundStyle(self.accent.color)
                .widgetAccentable()
            Text("widget.no_snapshot", tableName: widgetStringsTableName)
                .font(.headline)
                .lineLimit(4)
                .minimumScaleFactor(0.8)
            Spacer(minLength: 0)
        }
    }
}
