import SwiftUI

private let progressCalendarColumnCount: Int = 7
private let progressReviewCardsStringsTableName: String = "ReviewCards"
private let progressStreakBadgeSize: CGFloat = 34
private let progressStreakBadgeHorizontalPadding: CGFloat = 8

struct ProgressStreakSection: View {
    let weeks: [ProgressCalendarWeek]
    let badgeState: ReviewProgressBadgeState
    let calendar: Calendar

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: 10, alignment: .center), count: progressCalendarColumnCount)
    }

    private var headerDays: [ProgressCalendarDay] {
        self.weeks.first?.days ?? []
    }

    private var streakDays: [ProgressCalendarDay] {
        self.weeks.flatMap(\.days)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                ProgressStreakSummaryBadge(badgeState: self.badgeState)
                Spacer(minLength: 0)
            }

            LazyVGrid(columns: self.columns, spacing: 12) {
                ForEach(self.headerDays) { day in
                    Text(progressWeekdayLabel(date: day.date, calendar: self.calendar))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .accessibilityHidden(true)
                }

                ForEach(self.streakDays) { day in
                    ProgressStreakDayCell(day: day, calendar: self.calendar)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

private struct ProgressStreakSummaryBadge: View {
    let badgeState: ReviewProgressBadgeState

    private var presentation: ReviewProgressBadgePresentation {
        makeReviewProgressBadgePresentation(badgeState: self.badgeState)
    }

    var body: some View {
        ZStack {
            Capsule()
                .fill(Color(uiColor: .secondarySystemBackground))

            Capsule()
                .strokeBorder(self.presentation.borderColor, lineWidth: 1)

            HStack(spacing: 3) {
                Image(systemName: self.presentation.iconSystemName)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(self.presentation.iconColor)

                Text(formatReviewProgressBadgeValue(badgeState: self.badgeState))
                    .font(.caption2.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(self.presentation.textColor)
                    .minimumScaleFactor(0.65)
            }
            .padding(.horizontal, progressStreakBadgeHorizontalPadding)
        }
        .frame(minHeight: progressStreakBadgeSize)
        .fixedSize(horizontal: true, vertical: false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(self.accessibilityLabel)
    }

    private var accessibilityLabel: String {
        let localizedFormat: String
        if self.badgeState.hasReviewedToday {
            localizedFormat = String(
                localized: "review.progress_badge.accessibility.reviewed_today",
                defaultValue: "Review streak %@ days. Reviewed today.",
                table: progressReviewCardsStringsTableName,
                comment: "Accessibility label for the review progress badge when the user has reviewed today"
            )
        } else {
            localizedFormat = String(
                localized: "review.progress_badge.accessibility.not_reviewed_today",
                defaultValue: "Review streak %@ days. Not reviewed today.",
                table: progressReviewCardsStringsTableName,
                comment: "Accessibility label for the review progress badge when the user has not reviewed today"
            )
        }

        return String(
            format: localizedFormat,
            locale: Locale.current,
            self.badgeState.streakDays.formatted()
        )
    }
}

private struct ProgressStreakDayCell: View {
    let day: ProgressCalendarDay
    let calendar: Calendar

    var body: some View {
        ZStack {
            Circle()
                .fill(self.backgroundColor)

            Circle()
                .stroke(self.borderColor, lineWidth: self.borderLineWidth)

            if self.day.isFuturePlaceholder {
                Circle()
                    .fill(Color(uiColor: .tertiarySystemGroupedBackground))
                    .frame(width: 8, height: 8)
            } else if self.isActiveFlameDay {
                Image(systemName: "flame.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(self.foregroundColor)
            } else {
                Text(self.day.dayNumber.formatted())
                    .font(.footnote.weight(self.day.isToday ? .semibold : .regular))
                    .monospacedDigit()
                    .foregroundStyle(self.foregroundColor)
            }
        }
        .frame(width: 38, height: 38)
        .accessibilityElement(children: .ignore)
        .accessibilityHidden(self.day.isFuturePlaceholder)
        .accessibilityLabel(self.accessibilityLabel)
    }

    private var backgroundColor: Color {
        if self.day.isFuturePlaceholder {
            return Color.clear
        }

        if self.isActiveFlameDay {
            return .accentColor
        }

        return self.day.isToday ? .accentColor : Color(uiColor: .secondarySystemGroupedBackground)
    }

    private var borderColor: Color {
        if self.day.isFuturePlaceholder {
            return Color(uiColor: .separator).opacity(0.18)
        }

        if self.isActiveFlameDay {
            return .accentColor
        }

        if self.day.isToday {
            return Color.white.opacity(0.92)
        }

        return Color(uiColor: .separator).opacity(0.35)
    }

    private var foregroundColor: Color {
        if self.day.isFuturePlaceholder {
            return .secondary
        }

        if self.isActiveFlameDay {
            return .white
        }

        if self.day.isToday {
            return .white
        }

        return .primary
    }

    private var isActiveFlameDay: Bool {
        self.day.reviewCount > 0
    }

    private var borderLineWidth: CGFloat {
        self.day.isToday && self.isActiveFlameDay == false ? 2 : 1
    }

    private var accessibilityLabel: String {
        if self.day.isFuturePlaceholder {
            return ""
        }

        let dateTitle = progressCompleteDateLabel(date: self.day.date, calendar: self.calendar)
        let todayTitle = String(
            localized: "progress.screen.today",
            defaultValue: "Today",
            table: progressStringsTableName,
            comment: "Progress today label"
        )
        let reviewsTitle = String.localizedStringWithFormat(
            String(
                localized: "progress.screen.reviews.accessibility",
                defaultValue: "%lld reviews",
                table: progressStringsTableName,
                comment: "Accessibility label suffix for daily review counts"
            ),
            Int64(self.day.reviewCount)
        )

        if self.day.isToday {
            return "\(dateTitle), \(todayTitle), \(reviewsTitle)"
        }

        return "\(dateTitle), \(reviewsTitle)"
    }
}
