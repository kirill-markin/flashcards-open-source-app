import SwiftUI
import WidgetKit

let yearWidgetKind: String = "YearWidget"

private let yearWidgetMonthCount: Int = 12
private let yearWidgetLongestMonthDayCount: Int = 31
private let yearWidgetCellSpacing: CGFloat = 1.5
private let yearWidgetMinimumRowSpacing: CGFloat = 2
private let yearWidgetMonthLabelWidth: CGFloat = 30
private let yearWidgetMonthLabelSpacing: CGFloat = 4

struct YearWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: yearWidgetKind, provider: ReviewWidgetTimelineProvider()) { entry in
            YearWidgetView(entry: entry)
        }
        .configurationDisplayName(Text("widget.year.gallery.name", tableName: widgetStringsTableName))
        .description(Text("widget.year.gallery.description", tableName: widgetStringsTableName))
        .supportedFamilies([.systemLarge])
    }
}

/// One row of the Year widget: the first day of the month and one cell per day of it up to today; nil marks a day
/// outside the history.
struct YearWidgetMonth: Sendable, Equatable {
    let monthStart: Date
    let cells: [WidgetHeatmapCell?]
}

/// The last 12 months, oldest first, ending with the month of the snapshot's today; nil for progress that breaks its
/// contract.
func makeYearWidgetMonths(progress: WidgetSnapshotProgress, entryDate: Date) -> [YearWidgetMonth]? {
    guard let today = validatedWidgetHeatmapToday(progress: progress) else {
        return nil
    }
    let calendar = makeWidgetProgressCalendar(firstWeekday: progress.firstWeekday)
    let outlinedLocalDate = widgetHeatmapOutlinedLocalDate(progress: progress, entryDate: entryDate)
    guard let todayMonthStart = calendar.dateInterval(of: .month, for: today)?.start else {
        preconditionFailure("Cannot find the month of \(progress.todayLocalDate).")
    }
    let monthStarts = (0..<yearWidgetMonthCount).map { monthIndex in
        guard let monthStart = calendar.date(byAdding: .month, value: monthIndex - (yearWidgetMonthCount - 1), to: todayMonthStart) else {
            preconditionFailure("Cannot step \(monthIndex) months from \(todayMonthStart).")
        }
        return monthStart
    }
    let firstLocalDate = widgetProgressLocalDate(date: monthStarts[0], calendar: calendar)
    let shownDays = progress.days.filter { day in
        day.localDate >= firstLocalDate && day.localDate <= progress.todayLocalDate
    }
    let scale = makeWidgetHeatmapScale(days: shownDays)
    // Validated progress is strictly ascending, so its dates are unique.
    let daysByLocalDate = Dictionary(uniqueKeysWithValues: shownDays.map { day in (day.localDate, day) })
    return monthStarts.map { monthStart in
        guard let dayRange = calendar.range(of: .day, in: .month, for: monthStart) else {
            preconditionFailure("Cannot count the days of the month starting \(monthStart).")
        }
        let shownDates = dayRange
            .map { dayNumber in widgetProgressDate(byAddingDays: dayNumber - 1, to: monthStart, calendar: calendar) }
            .filter { date in date <= today }
        let cells = shownDates.map { date -> WidgetHeatmapCell? in
            guard let day = daysByLocalDate[widgetProgressLocalDate(date: date, calendar: calendar)] else {
                return nil
            }
            return makeWidgetHeatmapCell(day: day, scale: scale, outlinedLocalDate: outlinedLocalDate)
        }
        return YearWidgetMonth(monthStart: monthStart, cells: cells)
    }
}

struct YearWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ReviewWidgetEntry

    var body: some View {
        Group {
            if self.family == .systemLarge {
                Group {
                    if
                        let progress = self.entry.snapshot?.progress,
                        let months = makeYearWidgetMonths(progress: progress, entryDate: self.entry.date)
                    {
                        YearWidgetContentView(progress: progress, months: months)
                    } else {
                        WidgetNoSnapshotView()
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .widgetURL(
                    makeWidgetDeepLinkURL(
                        deepLink: WidgetDeepLink(
                            destination: .progress,
                            kind: .year,
                            workspaceId: self.entry.workspaceId,
                            size: .large,
                            cardId: nil
                        )
                    )
                )
            }
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }
}

private struct YearWidgetContentView: View {
    let progress: WidgetSnapshotProgress
    let months: [YearWidgetMonth]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            YearWidgetMonthGridView(months: self.months)
            HStack(spacing: 8) {
                Text("widget.heatmap.reviews_count \(widgetHeatmapReviewCount(days: self.progress.days))", tableName: widgetStringsTableName)
                Spacer(minLength: 0)
                Text("widget.heatmap.active_days_count \(widgetHeatmapActiveDayCount(days: self.progress.days))", tableName: widgetStringsTableName)
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
        }
    }
}

private struct YearWidgetMonthGridView: View {
    let months: [YearWidgetMonth]

    var body: some View {
        GeometryReader { geometry in
            let cellsWidth = geometry.size.width - yearWidgetMonthLabelWidth - yearWidgetMonthLabelSpacing
            let dayCount = CGFloat(yearWidgetLongestMonthDayCount)
            let monthCount = CGFloat(self.months.count)
            let widthSide = (cellsWidth - yearWidgetCellSpacing * (dayCount - 1)) / dayCount
            let heightSide = (geometry.size.height - yearWidgetMinimumRowSpacing * (monthCount - 1)) / monthCount
            let side = max(0, floor(min(widthSide, heightSide)))
            VStack(alignment: .leading, spacing: yearWidgetMinimumRowSpacing) {
                ForEach(self.months.indices, id: \.self) { monthIndex in
                    YearWidgetMonthRowView(month: self.months[monthIndex], side: side)
                        .frame(maxHeight: .infinity)
                }
            }
        }
    }
}

private struct YearWidgetMonthRowView: View {
    let month: YearWidgetMonth
    let side: CGFloat

    var body: some View {
        HStack(spacing: yearWidgetMonthLabelSpacing) {
            Text(self.month.monthStart, format: yearWidgetMonthLabelFormat())
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .frame(width: yearWidgetMonthLabelWidth, alignment: .leading)
            HStack(spacing: yearWidgetCellSpacing) {
                ForEach(self.month.cells.indices, id: \.self) { dayIndex in
                    if let cell = self.month.cells[dayIndex] {
                        WidgetHeatmapCellView(cell: cell, side: self.side)
                    } else {
                        Color.clear.frame(width: self.side, height: self.side)
                    }
                }
            }
            .accessibilityHidden(true)
            Spacer(minLength: 0)
        }
    }
}

/// Month starts are UTC midnights of the Progress calendar, so the label is formatted in that calendar and zone.
private func yearWidgetMonthLabelFormat() -> Date.FormatStyle {
    let calendar = makeWidgetProgressCalendar(firstWeekday: 1)
    return Date.FormatStyle(
        date: nil,
        time: nil,
        locale: .autoupdatingCurrent,
        calendar: calendar,
        timeZone: calendar.timeZone,
        capitalizationContext: .standalone
    ).month(.abbreviated)
}
