import SwiftUI

struct ProgressUnavailableCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ContentUnavailableView(
                String(
                    localized: "progress.screen.unavailable.title",
                    defaultValue: "Progress is unavailable",
                    table: progressStringsTableName,
                    comment: "Progress unavailable title"
                ),
                systemImage: "chart.bar.xaxis",
                description: Text(
                    String(
                        localized: "progress.screen.unavailable.description",
                        defaultValue: "Open review or reconnect cloud data, then refresh progress.",
                        table: progressStringsTableName,
                        comment: "Progress unavailable description"
                    )
                )
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .modifier(ProgressCardModifier())
    }
}
