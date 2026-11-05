import SwiftUI
import WidgetKit

let reviewWidgetKind: String = "ReviewWidget"
let widgetStringsTableName: String = "Widget"

@main
struct FlashcardsWidgetBundle: WidgetBundle {
    var body: some Widget {
        ReviewWidget()
    }
}

struct ReviewWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: reviewWidgetKind, provider: ReviewWidgetTimelineProvider()) { entry in
            ReviewWidgetView(entry: entry)
        }
        .configurationDisplayName(Text("widget.gallery.name", tableName: widgetStringsTableName))
        .description(Text("widget.gallery.description", tableName: widgetStringsTableName))
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
