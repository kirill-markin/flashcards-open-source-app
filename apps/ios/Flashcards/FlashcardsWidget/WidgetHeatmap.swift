import OSLog
import SwiftUI
import WidgetKit

// A day saved by a streak freeze is an outlined ice cell, mirroring the Progress streak calendar, so it never reads
// as a solid light-review fill.
private let widgetHeatmapFrozenLightFillColor: Color = Color(red: 0xE6 / 255, green: 0xF4 / 255, blue: 0xFF / 255)
private let widgetHeatmapFrozenLightBorderColor: Color = Color(red: 0x2A / 255, green: 0x7F / 255, blue: 0xC2 / 255)
private let widgetHeatmapFrozenDarkBorderColor: Color = Color(red: 0x9D / 255, green: 0xD8 / 255, blue: 0xFF / 255)
/// A white Dark cell, as in Progress, would outshine every reviewed day, so Dark keeps a faint ice fill.
private let widgetHeatmapFrozenDarkFillOpacity: Double = 0.2
/// Tinted and clear Home Screens flatten colours, so the frozen outline falls back to this primary opacity.
private let widgetHeatmapFrozenMonochromeBorderOpacity: Double = 0.6
private let widgetHeatmapEmptyOpacity: Double = 0.1
/// A tinted light Home Screen washes out the full-colour empty opacity.
private let widgetHeatmapMonochromeEmptyOpacity: Double = 0.18
private let widgetHeatmapMonochromeReviewedOpacities: [Double] = [0.3, 0.5, 0.75, 1]
// A custom accent may only just contrast with the background, so keep level one distinct from an empty cell.
private let widgetHeatmapReviewedOpacities: [Double] = [0.45, 0.6, 0.8, 1]
/// Frozen border and today outline width; the fraction thins it on small Year cells, where 1.5 pt would fill most of
/// the cell and read as a solid reviewed day.
private let widgetHeatmapStrokeMaxWidth: CGFloat = 1.5
private let widgetHeatmapStrokeSideFraction: CGFloat = 0.15

enum WidgetHeatmapCellFill: Hashable, Sendable {
    case empty
    /// 1 is the fewest reviews, 4 the most.
    case reviewed(level: Int)
    case frozen
}

struct WidgetHeatmapCell: Hashable, Sendable {
    let localDate: String
    let fill: WidgetHeatmapCellFill
    let isToday: Bool
}

/// The smallest review count of the 2nd, 3rd and 4th quartile of the non-zero days a widget shows, so a light user
/// still sees contrast; equal counts all reach the top level.
struct WidgetHeatmapScale: Sendable, Equatable {
    let levelLowerBounds: [Int]
}

func makeWidgetHeatmapScale(days: [WidgetSnapshotProgressDay]) -> WidgetHeatmapScale {
    let reviewedCounts = days.map(\.reviewCount).filter { reviewCount in reviewCount > 0 }.sorted()
    guard reviewedCounts.isEmpty == false else {
        return WidgetHeatmapScale(levelLowerBounds: [])
    }
    let levelLowerBounds = [1, 2, 3].map { quartile in
        reviewedCounts[(reviewedCounts.count * quartile) / 4]
    }
    return WidgetHeatmapScale(levelLowerBounds: levelLowerBounds)
}

func makeWidgetHeatmapCell(day: WidgetSnapshotProgressDay, scale: WidgetHeatmapScale, outlinedLocalDate: String?) -> WidgetHeatmapCell {
    let fill: WidgetHeatmapCellFill
    if day.reviewCount > 0 {
        let reachedBoundCount = scale.levelLowerBounds.filter { lowerBound in day.reviewCount >= lowerBound }.count
        fill = .reviewed(level: 1 + reachedBoundCount)
    } else if day.streakState == .frozen {
        fill = .frozen
    } else {
        fill = .empty
    }
    return WidgetHeatmapCell(localDate: day.localDate, fill: fill, isToday: day.localDate == outlinedLocalDate)
}

/// The snapshot's today, outlined only while the entry date is still that day.
func widgetHeatmapOutlinedLocalDate(progress: WidgetSnapshotProgress, entryDate: Date) -> String? {
    isWidgetProgressForDay(progress: progress, date: entryDate) ? progress.todayLocalDate : nil
}

/// Gregorian day arithmetic on `yyyy-MM-dd` Progress dates; UTC keeps every day exactly one calendar day long.
func makeWidgetProgressCalendar(firstWeekday: Int) -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.locale = Locale(identifier: "en_US_POSIX")
    guard let utcTimeZone = TimeZone(identifier: "UTC") else {
        preconditionFailure("The UTC time zone is unavailable.")
    }
    calendar.timeZone = utcTimeZone
    calendar.firstWeekday = firstWeekday
    return calendar
}

/// Nil unless `localDate` is a real `yyyy-MM-dd` day; the round trip rejects parts the calendar would normalize.
func widgetProgressDate(localDate: String, calendar: Calendar) -> Date? {
    let parts = localDate.split(separator: "-", omittingEmptySubsequences: false).map { part in Int(part) }
    guard
        parts.count == 3,
        let year = parts[0],
        let month = parts[1],
        let day = parts[2],
        let date = calendar.date(from: DateComponents(year: year, month: month, day: day)),
        widgetProgressLocalDate(date: date, calendar: calendar) == localDate
    else {
        return nil
    }
    return date
}

/// The snapshot's today, or nil, logged, when `progress` breaks its contract: real `yyyy-MM-dd` days, strictly
/// ascending, ending with `todayLocalDate`, and a `firstWeekday` from 1 through 7.
func validatedWidgetHeatmapToday(progress: WidgetSnapshotProgress) -> Date? {
    let calendar = makeWidgetProgressCalendar(firstWeekday: 1)
    let invalidLocalDate = progress.days.first { day in
        widgetProgressDate(localDate: day.localDate, calendar: calendar) == nil
    }?.localDate
    let isAscending = zip(progress.days, progress.days.dropFirst()).allSatisfy { earlierDay, laterDay in
        earlierDay.localDate < laterDay.localDate
    }
    guard
        (1...7).contains(progress.firstWeekday),
        invalidLocalDate == nil,
        isAscending,
        progress.days.last?.localDate == progress.todayLocalDate,
        let today = widgetProgressDate(localDate: progress.todayLocalDate, calendar: calendar)
    else {
        reviewWidgetLogger.error(
            "event=heatmap_widget_progress_invalid todayLocalDate=\(progress.todayLocalDate, privacy: .public) lastLocalDate=\(String(describing: progress.days.last?.localDate), privacy: .public) invalidLocalDate=\(String(describing: invalidLocalDate), privacy: .public) isAscending=\(isAscending, privacy: .public) firstWeekday=\(progress.firstWeekday, privacy: .public) dayCount=\(progress.days.count, privacy: .public)"
        )
        return nil
    }
    return today
}

func widgetProgressLocalDate(date: Date, calendar: Calendar) -> String {
    let components = calendar.dateComponents([.year, .month, .day], from: date)
    guard let year = components.year, let month = components.month, let day = components.day else {
        preconditionFailure("Widget progress date components are unavailable for \(date).")
    }
    return String(format: "%04d-%02d-%02d", year, month, day)
}

func widgetProgressDate(byAddingDays dayCount: Int, to date: Date, calendar: Calendar) -> Date {
    guard let shiftedDate = calendar.date(byAdding: .day, value: dayCount, to: date) else {
        preconditionFailure("Cannot add \(dayCount) days to \(date).")
    }
    return shiftedDate
}

func widgetHeatmapReviewCount(days: [WidgetSnapshotProgressDay]) -> Int {
    days.reduce(0) { total, day in total + day.reviewCount }
}

func widgetHeatmapActiveDayCount(days: [WidgetSnapshotProgressDay]) -> Int {
    days.filter { day in day.reviewCount > 0 }.count
}

/// One heatmap square; a frozen day is outlined so it stays apart from reviewed days. Tinted and clear Home Screens draw
/// accentable content opaque, so there the levels are a non-accentable primary ramp and today's fill sits inside its
/// outline, which would otherwise vanish against a top-level fill.
struct WidgetHeatmapCellView: View {
    @Environment(\.widgetAccent) private var accent
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.widgetRenderingMode) private var renderingMode
    let cell: WidgetHeatmapCell
    let side: CGFloat

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: self.side * 0.22, style: .continuous)
        let strokeWidth = min(widgetHeatmapStrokeMaxWidth, self.side * widgetHeatmapStrokeSideFraction)
        let fillInset = self.needsTodayFillInset ? strokeWidth * 2 : 0
        Group {
            switch self.cell.fill {
            case .empty:
                shape.fill(self.emptyFillColor)
            case .reviewed(let level):
                shape.fill(self.reviewedFillColor(level: level))
                    .widgetAccentable(self.renderingMode != .accented)
            case .frozen:
                shape.fill(self.frozenFillColor)
                    .overlay {
                        shape.strokeBorder(self.frozenBorderColor, lineWidth: strokeWidth)
                    }
            }
        }
        .padding(fillInset)
        .overlay {
            if self.cell.isToday {
                shape.strokeBorder(Color.primary, lineWidth: strokeWidth)
            }
        }
        .frame(width: self.side, height: self.side)
    }

    private var emptyFillColor: Color {
        Color.primary.opacity(
            self.renderingMode == .accented ? widgetHeatmapMonochromeEmptyOpacity : widgetHeatmapEmptyOpacity
        )
    }

    private var needsTodayFillInset: Bool {
        guard self.cell.isToday else { return false }
        if self.renderingMode == .accented { return true }
        if case .reviewed = self.cell.fill {
            return self.renderingMode == .fullColor
        }
        return false
    }

    private func reviewedFillColor(level: Int) -> Color {
        switch self.renderingMode {
        case .fullColor:
            return self.accent.color.opacity(widgetHeatmapReviewedOpacities[level - 1])
        case .accented:
            return Color.primary.opacity(widgetHeatmapMonochromeReviewedOpacities[level - 1])
        default:
            return self.accent.color.opacity(widgetHeatmapMonochromeReviewedOpacities[level - 1])
        }
    }

    private var frozenFillColor: Color {
        guard self.renderingMode == .fullColor else {
            return self.emptyFillColor
        }
        return self.colorScheme == .dark
            ? widgetHeatmapFrozenDarkBorderColor.opacity(widgetHeatmapFrozenDarkFillOpacity)
            : widgetHeatmapFrozenLightFillColor
    }

    private var frozenBorderColor: Color {
        guard self.renderingMode == .fullColor else {
            return Color.primary.opacity(widgetHeatmapFrozenMonochromeBorderOpacity)
        }
        return self.colorScheme == .dark ? widgetHeatmapFrozenDarkBorderColor : widgetHeatmapFrozenLightBorderColor
    }
}

/// The days of the last `weekCount` calendar weeks up to the snapshot's today, and their cells as columns of seven,
/// oldest week first, rows starting at the Progress first weekday; nil marks a day after today or outside the history.
struct WidgetHeatmapWeeks: Sendable, Equatable {
    let shownDays: [WidgetSnapshotProgressDay]
    let columns: [[WidgetHeatmapCell?]]
    /// Nil unless the entry date is still the snapshot's today.
    let today: WidgetSnapshotProgressDay?
}

/// Nil for progress that breaks its contract.
func makeWidgetHeatmapWeeks(progress: WidgetSnapshotProgress, weekCount: Int, entryDate: Date) -> WidgetHeatmapWeeks? {
    guard let today = validatedWidgetHeatmapToday(progress: progress) else {
        return nil
    }
    let calendar = makeWidgetProgressCalendar(firstWeekday: progress.firstWeekday)
    let outlinedLocalDate = widgetHeatmapOutlinedLocalDate(progress: progress, entryDate: entryDate)
    let todayWeekdayOffset = (calendar.component(.weekday, from: today) - calendar.firstWeekday + 7) % 7
    let firstDay = widgetProgressDate(byAddingDays: -todayWeekdayOffset - 7 * (weekCount - 1), to: today, calendar: calendar)
    let firstLocalDate = widgetProgressLocalDate(date: firstDay, calendar: calendar)
    let shownDays = progress.days.filter { day in
        day.localDate >= firstLocalDate && day.localDate <= progress.todayLocalDate
    }
    let scale = makeWidgetHeatmapScale(days: shownDays)
    // Validated progress is strictly ascending, so its dates are unique.
    let daysByLocalDate = Dictionary(uniqueKeysWithValues: shownDays.map { day in (day.localDate, day) })
    let columns = (0..<weekCount).map { weekIndex in
        (0..<7).map { weekdayIndex -> WidgetHeatmapCell? in
            let date = widgetProgressDate(byAddingDays: weekIndex * 7 + weekdayIndex, to: firstDay, calendar: calendar)
            guard let day = daysByLocalDate[widgetProgressLocalDate(date: date, calendar: calendar)] else {
                return nil
            }
            return makeWidgetHeatmapCell(day: day, scale: scale, outlinedLocalDate: outlinedLocalDate)
        }
    }
    return WidgetHeatmapWeeks(
        shownDays: shownDays,
        columns: columns,
        today: shownDays.first { day in day.localDate == outlinedLocalDate }
    )
}

/// Fits square cells into the offered space; days without a cell keep their slot empty.
struct WidgetHeatmapWeekGridView: View {
    let columns: [[WidgetHeatmapCell?]]
    let spacing: CGFloat

    var body: some View {
        GeometryReader { geometry in
            let columnCount = CGFloat(self.columns.count)
            let widthSide = (geometry.size.width - self.spacing * (columnCount - 1)) / columnCount
            let heightSide = (geometry.size.height - self.spacing * 6) / 7
            let side = max(0, floor(min(widthSide, heightSide)))
            HStack(alignment: .top, spacing: self.spacing) {
                ForEach(self.columns.indices, id: \.self) { columnIndex in
                    VStack(spacing: self.spacing) {
                        ForEach(0..<7, id: \.self) { rowIndex in
                            if let cell = self.columns[columnIndex][rowIndex] {
                                WidgetHeatmapCellView(cell: cell, side: side)
                            } else {
                                Color.clear.frame(width: side, height: side)
                            }
                        }
                    }
                }
            }
        }
        .accessibilityHidden(true)
    }
}
