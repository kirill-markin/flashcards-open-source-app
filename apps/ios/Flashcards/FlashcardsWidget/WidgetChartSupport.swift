import SwiftUI
import WidgetKit

/// The Home Screen families the chart widgets support.
enum WidgetChartSize {
    case medium
    case large

    var deepLinkSize: WidgetDeepLinkSize {
        switch self {
        case .medium:
            return .medium
        case .large:
            return .large
        }
    }
}

/// Nil only for families a chart widget does not declare as supported.
func widgetChartSize(family: WidgetFamily) -> WidgetChartSize? {
    switch family {
    case .systemMedium:
        return .medium
    case .systemLarge:
        return .large
    default:
        return nil
    }
}

enum WidgetReviewRating: CaseIterable {
    case again
    case hard
    case good
    case easy

    var title: Text {
        switch self {
        case .again:
            return Text("widget.rating.again", tableName: widgetStringsTableName)
        case .hard:
            return Text("widget.rating.hard", tableName: widgetStringsTableName)
        case .good:
            return Text("widget.rating.good", tableName: widgetStringsTableName)
        case .easy:
            return Text("widget.rating.easy", tableName: widgetStringsTableName)
        }
    }
}

func widgetReviewRatingCount(day: WidgetSnapshotProgressDay, rating: WidgetReviewRating) -> Int {
    switch rating {
    case .again:
        return day.againCount
    case .hard:
        return day.hardCount
    case .good:
        return day.goodCount
    case .easy:
        return day.easyCount
    }
}

// Copied from Flashcards/Progress/Presentation/ProgressFormatting.swift::progressReviewRatingColor.
func widgetReviewRatingColor(rating: WidgetReviewRating) -> Color {
    switch rating {
    case .again:
        return Color(red: 0xD7 / 255, green: 0x26 / 255, blue: 0x3D / 255)
    case .hard:
        return Color(red: 0xE6 / 255, green: 0x9F / 255, blue: 0x00 / 255)
    case .good:
        return Color(red: 0x2B / 255, green: 0xB6 / 255, blue: 0x73 / 255)
    case .easy:
        return Color(red: 0x3F / 255, green: 0x7C / 255, blue: 0xC8 / 255)
    }
}

// Copied from Flashcards/Progress/Presentation/ProgressFormatting.swift::progressReviewScheduleBucketColor.
func widgetScheduleBucketColor(key: WidgetSnapshotScheduleBucketKey) -> Color {
    switch key {
    case .new:
        return Color(red: 0xF4 / 255, green: 0xC4 / 255, blue: 0x30 / 255)
    case .today:
        return Color(red: 0xD7 / 255, green: 0x26 / 255, blue: 0x3D / 255)
    case .days1To7:
        return Color(red: 0x1F / 255, green: 0xB5 / 255, blue: 0xC1 / 255)
    case .days8To30:
        return Color(red: 0x8E / 255, green: 0x5B / 255, blue: 0xD9 / 255)
    case .days31To90:
        return Color(red: 0x2B / 255, green: 0xB6 / 255, blue: 0x73 / 255)
    case .days91To360:
        return Color(red: 0xE6 / 255, green: 0x9F / 255, blue: 0x00 / 255)
    case .years1To2:
        return Color(red: 0x3F / 255, green: 0x7C / 255, blue: 0xC8 / 255)
    case .later:
        return Color(red: 0x7A / 255, green: 0x80 / 255, blue: 0x88 / 255)
    }
}

func widgetScheduleBucketTitle(key: WidgetSnapshotScheduleBucketKey) -> Text {
    switch key {
    case .new:
        return Text("widget.schedule.bucket.new", tableName: widgetStringsTableName)
    case .today:
        return Text("widget.schedule.bucket.today", tableName: widgetStringsTableName)
    case .days1To7:
        return Text("widget.schedule.bucket.days_1_to_7", tableName: widgetStringsTableName)
    case .days8To30:
        return Text("widget.schedule.bucket.days_8_to_30", tableName: widgetStringsTableName)
    case .days31To90:
        return Text("widget.schedule.bucket.days_31_to_90", tableName: widgetStringsTableName)
    case .days91To360:
        return Text("widget.schedule.bucket.days_91_to_360", tableName: widgetStringsTableName)
    case .years1To2:
        return Text("widget.schedule.bucket.years_1_to_2", tableName: widgetStringsTableName)
    case .later:
        return Text("widget.schedule.bucket.later", tableName: widgetStringsTableName)
    }
}

/// Tinted and accented Home Screens drop hues, so there the series of a multicolour mark stay apart by opacity.
func widgetSeriesColor(
    color: Color,
    seriesIndex: Int,
    seriesCount: Int,
    renderingMode: WidgetRenderingMode
) -> Color {
    guard renderingMode != .fullColor else {
        return color
    }
    let position = seriesCount > 1 ? Double(seriesIndex) / Double(seriesCount - 1) : 0
    return Color.primary.opacity(1 - 0.7 * position)
}

/// The colour swatch of a chart legend; the thin outline keeps light hues defined on pale backgrounds.
struct WidgetLegendSwatch: View {
    let color: Color

    var body: some View {
        Circle()
            .fill(self.color)
            .overlay(Circle().strokeBorder(Color.secondary.opacity(0.4), lineWidth: 0.5))
            .frame(width: 8, height: 8)
    }
}
