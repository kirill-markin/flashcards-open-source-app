import OSLog
import SwiftUI
import WidgetKit

let monthCalendarWidgetKind: String = "MonthCalendarWidget"

private let monthCalendarWidgetLargeMarkDiameter: CGFloat = 28
private let monthCalendarWidgetLargeFrozenOutlineDiameter: CGFloat = 24
private let monthCalendarWidgetLargeTodayRingDiameter: CGFloat = 32
private let monthCalendarWidgetLargeRowHeight: CGFloat = 34
private let monthCalendarWidgetSmallDotDiameter: CGFloat = 9
private let monthCalendarWidgetSmallTodayRingDiameter: CGFloat = 13
private let monthCalendarWidgetFrozenOutlineWidth: CGFloat = 1.5

struct MonthCalendarWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: monthCalendarWidgetKind, provider: ReviewWidgetTimelineProvider()) { entry in
            MonthCalendarWidgetView(entry: entry)
        }
        .configurationDisplayName(Text("widget.month_calendar.gallery.name", tableName: widgetStringsTableName))
        .description(Text("widget.month_calendar.gallery.description", tableName: widgetStringsTableName))
        .supportedFamilies([.systemSmall, .systemLarge])
    }
}

struct MonthCalendarWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ReviewWidgetEntry

    var body: some View {
        Group {
            if let size = monthCalendarWidgetSize(family: self.family) {
                MonthCalendarWidgetContentView(
                    size: size,
                    progress: makeStreakWidgetProgress(
                        progress: self.entry.snapshot?.progress,
                        entryDate: self.entry.date
                    )
                )
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .widgetURL(
                        makeWidgetDeepLinkURL(
                            deepLink: WidgetDeepLink(
                                destination: .progress,
                                kind: .monthCalendar,
                                workspaceId: self.entry.workspaceId,
                                size: size.deepLinkSize,
                                cardId: nil,
                                revealAnswer: false
                            )
                        )
                    )
            }
        }
        .homeScreenWidgetStyle(accentColor: self.entry.snapshot?.accentColor)
    }
}

/// The Home Screen families the Month calendar widget supports.
private enum MonthCalendarWidgetSize {
    case small
    case large

    var deepLinkSize: WidgetDeepLinkSize {
        switch self {
        case .small:
            return .small
        case .large:
            return .large
        }
    }
}

/// Nil only for families the widget does not declare as supported.
private func monthCalendarWidgetSize(family: WidgetFamily) -> MonthCalendarWidgetSize? {
    switch family {
    case .systemSmall:
        return .small
    case .systemLarge:
        return .large
    default:
        return nil
    }
}

private enum MonthCalendarWidgetDayMark: Equatable {
    case reviewed
    case frozen
    case unmarked
}

private struct MonthCalendarWidgetDay: Equatable {
    let dayNumber: Int
    let mark: MonthCalendarWidgetDayMark
    let isToday: Bool
    /// Whether the mark joins the neighbouring marked day of the same week row into one pill.
    let joinsPrevious: Bool
    let joinsNext: Bool
}

private struct MonthCalendarWidgetMonth: Equatable {
    let monthStart: Date
    let weekdaySymbols: [String]
    /// Rows of 7 cells starting at the first weekday; nil cells lie outside the month.
    let weeks: [[MonthCalendarWidgetDay?]]
}

/// The month of today; days after today and before the history window carry no mark.
/// Nil when today's month cannot be laid out.
private func makeMonthCalendarWidgetMonth(streakProgress: StreakWidgetProgress) -> MonthCalendarWidgetMonth? {
    let calendar = streakProgress.dayCalendar
    let today = streakProgress.today
    let monthDates: [Date]? = calendar.dateInterval(of: .month, for: today).flatMap { month in
        let dayCount = calendar.dateComponents([.day], from: month.start, to: month.end).day ?? 0
        let dates = (0..<max(dayCount, 0)).compactMap { dayOffset in
            calendar.date(byAdding: .day, value: dayOffset, to: month.start)
        }
        return dates.isEmpty || dates.count != dayCount ? nil : dates
    }
    guard let monthDates, let monthStart = monthDates.first else {
        reviewWidgetLogger.error(
            "event=month_calendar_widget_month_invalid todayLocalDate=\(streakProgress.progress.todayLocalDate, privacy: .public)"
        )
        return nil
    }
    // `dayDates` are strictly ascending, so unique.
    let streakStatesByDate: [Date: WidgetSnapshotStreakDayState] = Dictionary(
        uniqueKeysWithValues: zip(streakProgress.dayDates, streakProgress.progress.days.map(\.streakState))
    )
    let monthDayCount = monthDates.count
    let marks: [MonthCalendarWidgetDayMark] = monthDates.map { date in
        switch streakStatesByDate[date] {
        case .reviewed:
            return .reviewed
        case .frozen:
            return .frozen
        case .missed, .pending, nil:
            return .unmarked
        }
    }
    let todayDayNumber = calendar.component(.day, from: today)
    let firstWeekday = streakProgress.displayCalendar.firstWeekday
    let leadingBlankCount = (calendar.component(.weekday, from: monthStart) - firstWeekday + 7) % 7
    let trailingBlankCount = (7 - (leadingBlankCount + monthDayCount) % 7) % 7
    let dayCells: [MonthCalendarWidgetDay?] = marks.indices.map { index in
        let mark = marks[index]
        let column = (leadingBlankCount + index) % 7
        return MonthCalendarWidgetDay(
            dayNumber: index + 1,
            mark: mark,
            isToday: index + 1 == todayDayNumber,
            joinsPrevious: mark != .unmarked && column > 0 && index > 0 && marks[index - 1] != .unmarked,
            joinsNext: mark != .unmarked && column < 6 && index < marks.count - 1 && marks[index + 1] != .unmarked
        )
    }
    let cells: [MonthCalendarWidgetDay?] = Array(repeating: nil, count: leadingBlankCount) + dayCells
        + Array(repeating: nil, count: trailingBlankCount)
    let weeks = stride(from: 0, to: cells.count, by: 7).map { rowStart in
        Array(cells[rowStart..<rowStart + 7])
    }
    let symbols = streakProgress.displayCalendar.veryShortStandaloneWeekdaySymbols
    guard symbols.count == 7 else {
        reviewWidgetLogger.error("event=month_calendar_widget_weekday_symbols_invalid count=\(symbols.count, privacy: .public)")
        return nil
    }
    let weekdaySymbols = (0..<7).map { offset in
        symbols[(firstWeekday - 1 + offset) % 7]
    }
    return MonthCalendarWidgetMonth(monthStart: monthStart, weekdaySymbols: weekdaySymbols, weeks: weeks)
}

private struct MonthCalendarWidgetContentView: View {
    let size: MonthCalendarWidgetSize
    let progress: StreakWidgetProgress?

    var body: some View {
        if let progress, let month = makeMonthCalendarWidgetMonth(streakProgress: progress) {
            let monthFormatStyle = progress.dateFormatStyle
            switch self.size {
            case .small:
                MonthCalendarWidgetSmallView(month: month, monthFormatStyle: monthFormatStyle.month(.wide))
            case .large:
                MonthCalendarWidgetLargeView(month: month, monthFormatStyle: monthFormatStyle.month(.wide).year())
            }
        } else {
            WidgetNoSnapshotView()
        }
    }
}

private struct MonthCalendarWidgetLargeView: View {
    let month: MonthCalendarWidgetMonth
    let monthFormatStyle: Date.FormatStyle

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(self.month.monthStart, format: self.monthFormatStyle)
                .font(.headline)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            HStack(spacing: 0) {
                ForEach(self.month.weekdaySymbols.indices, id: \.self) { index in
                    Text(verbatim: self.month.weekdaySymbols[index])
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity)
                }
            }
            VStack(spacing: 2) {
                ForEach(self.month.weeks.indices, id: \.self) { weekIndex in
                    HStack(spacing: 0) {
                        ForEach(0..<7, id: \.self) { column in
                            MonthCalendarWidgetLargeDayCell(day: self.month.weeks[weekIndex][column])
                        }
                    }
                }
            }
            Spacer(minLength: 0)
        }
    }
}

private struct MonthCalendarWidgetLargeDayCell: View {
    @Environment(\.widgetAccent) private var accent
    @Environment(\.widgetRenderingMode) private var renderingMode
    let day: MonthCalendarWidgetDay?

    var body: some View {
        ZStack {
            if let day {
                switch day.mark {
                case .reviewed:
                    self.dayPill(day: day, color: self.accent.color)
                        .widgetAccentable()
                case .frozen:
                    let isFullColor = self.renderingMode == .fullColor
                    self.dayPill(day: day, color: isFullColor ? streakWidgetFrozenColor : .primary)
                        .compositingGroup()
                        .opacity(isFullColor ? 1 : 0.25)
                    Circle()
                        .strokeBorder(self.frozenLabelColor, lineWidth: monthCalendarWidgetFrozenOutlineWidth)
                        .frame(
                            width: monthCalendarWidgetLargeFrozenOutlineDiameter,
                            height: monthCalendarWidgetLargeFrozenOutlineDiameter
                        )
                case .unmarked:
                    EmptyView()
                }
                if day.isToday {
                    Circle()
                        .strokeBorder(Color.primary, lineWidth: 1.5)
                        .frame(
                            width: monthCalendarWidgetLargeTodayRingDiameter,
                            height: monthCalendarWidgetLargeTodayRingDiameter
                        )
                }
                Text(day.dayNumber, format: .number)
                    .font(.subheadline.weight(day.mark == .unmarked ? .regular : .semibold))
                    .foregroundStyle(self.labelColor(mark: day.mark))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: monthCalendarWidgetLargeRowHeight)
    }

    private func dayPill(day: MonthCalendarWidgetDay, color: Color) -> some View {
        ZStack {
            HStack(spacing: 0) {
                Rectangle().fill(day.joinsPrevious ? color : .clear)
                Rectangle().fill(day.joinsNext ? color : .clear)
            }
            .frame(height: monthCalendarWidgetLargeMarkDiameter)
            Circle()
                .fill(color)
                .frame(width: monthCalendarWidgetLargeMarkDiameter, height: monthCalendarWidgetLargeMarkDiameter)
        }
    }

    private var frozenLabelColor: Color {
        self.renderingMode == .fullColor ? .white : .primary
    }

    private func labelColor(mark: MonthCalendarWidgetDayMark) -> Color {
        switch mark {
        case .reviewed:
            return self.accent.filledLabelColor
        case .frozen:
            return self.frozenLabelColor
        case .unmarked:
            return .primary
        }
    }
}

private struct MonthCalendarWidgetSmallView: View {
    let month: MonthCalendarWidgetMonth
    let monthFormatStyle: Date.FormatStyle

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(self.month.monthStart, format: self.monthFormatStyle)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            VStack(spacing: 0) {
                ForEach(self.month.weeks.indices, id: \.self) { weekIndex in
                    HStack(spacing: 0) {
                        ForEach(0..<7, id: \.self) { column in
                            MonthCalendarWidgetSmallDayCell(day: self.month.weeks[weekIndex][column])
                        }
                    }
                    .frame(maxHeight: .infinity)
                }
            }
        }
    }
}

private struct MonthCalendarWidgetSmallDayCell: View {
    @Environment(\.widgetAccent) private var accent
    @Environment(\.widgetRenderingMode) private var renderingMode
    let day: MonthCalendarWidgetDay?

    var body: some View {
        ZStack {
            if let day {
                Group {
                    switch day.mark {
                    case .reviewed:
                        Circle()
                            .fill(self.accent.color)
                            .widgetAccentable()
                    case .frozen:
                        Circle()
                            .strokeBorder(
                                self.renderingMode == .fullColor ? streakWidgetFrozenColor : Color.primary.opacity(0.6),
                                lineWidth: monthCalendarWidgetFrozenOutlineWidth
                            )
                    case .unmarked:
                        Circle()
                            .fill(Color.secondary.opacity(0.3))
                    }
                }
                .frame(width: monthCalendarWidgetSmallDotDiameter, height: monthCalendarWidgetSmallDotDiameter)
                if day.isToday {
                    Circle()
                        .strokeBorder(Color.primary, lineWidth: 1.5)
                        .frame(
                            width: monthCalendarWidgetSmallTodayRingDiameter,
                            height: monthCalendarWidgetSmallTodayRingDiameter
                        )
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: monthCalendarWidgetSmallTodayRingDiameter)
    }
}
