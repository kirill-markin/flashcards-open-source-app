import SwiftUI

private let progressReviewCardsStringsTableName: String = "ReviewCards"
private let progressStreakBadgeSize: CGFloat = 34
private let progressStreakBadgeHorizontalPadding: CGFloat = 8
private let progressStreakCalendarColumnSpacing: CGFloat = 10
private let progressStreakCalendarHeaderSpacing: CGFloat = 10
private let progressStreakCalendarWeekSpacing: CGFloat = 12
private let progressFrozenStreakBorderColor = Color(red: 0x9D / 255, green: 0xD8 / 255, blue: 0xFF / 255)
private let progressFrozenStreakContentColor = Color(red: 0x2A / 255, green: 0x7F / 255, blue: 0xC2 / 255)

struct ProgressStreakSection: View {
    let weeks: [ProgressCalendarWeek]
    let badgeState: ReviewProgressBadgeState
    let streakFreeze: ProgressStreakFreeze
    let calendar: Calendar

    @State private var isFreezeInfoAlertPresented: Bool = false

    private var headerDays: [ProgressCalendarDay] {
        self.weeks.first?.days ?? []
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                ProgressStreakSummaryBadge(badgeState: self.badgeState)
                if self.badgeState.showsStreakFreezeBank {
                    ProgressFreezeBankChip(
                        badgeState: self.badgeState,
                        onShowInfo: { self.isFreezeInfoAlertPresented = true }
                    )
                }
                Spacer(minLength: 0)
            }

            ProgressStreakCalendarGrid(
                headerDays: self.headerDays,
                weeks: self.weeks,
                calendar: self.calendar
            )
        }
        .padding(.vertical, 4)
        .alert(
            self.freezeInfoTitle,
            isPresented: self.$isFreezeInfoAlertPresented
        ) {
            Button(
                String(
                    localized: "shared.ok",
                    table: "Foundation",
                    comment: "Confirmation button title"
                ),
                role: .cancel
            ) {}
        } message: {
            Text(self.freezeInfoMessage)
        }
    }

    private var freezeInfoTitle: String {
        String(
            localized: "progress.freeze_bank.info.title",
            defaultValue: "Streak freezes",
            table: "Foundation",
            comment: "Title for the streak freeze bank explanation alert"
        )
    }

    private var freezeInfoMessage: String {
        let localizedFormat = String(
            localized: "progress.freeze_bank.info.message",
            defaultValue: "Available: %@/%@. Recharge: %@/%@. Freezes protect missed days and recharge as your streak continues.",
            table: "Foundation",
            comment: "Body for the streak freeze bank explanation alert. Parameters are available credits, capacity, next credit progress, and next credit required units."
        )
        return String(
            format: localizedFormat,
            locale: Locale.current,
            self.streakFreeze.availableCredits.formatted(),
            self.streakFreeze.capacity.formatted(),
            self.streakFreeze.nextCreditProgressUnits.formatted(),
            self.streakFreeze.nextCreditRequiredUnits.formatted()
        )
    }
}

private struct ProgressStreakCalendarGrid: View {
    let headerDays: [ProgressCalendarDay]
    let weeks: [ProgressCalendarWeek]
    let calendar: Calendar

    var body: some View {
        VStack(alignment: .leading, spacing: progressStreakCalendarHeaderSpacing) {
            HStack(spacing: progressStreakCalendarColumnSpacing) {
                ForEach(self.headerDays) { day in
                    Text(progressWeekdayLabel(date: day.date, calendar: self.calendar))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .accessibilityHidden(true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .leading, spacing: progressStreakCalendarWeekSpacing) {
                ForEach(self.weeks) { week in
                    ProgressStreakWeekRow(week: week, calendar: self.calendar)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ProgressStreakWeekRow: View {
    let week: ProgressCalendarWeek
    let calendar: Calendar

    var body: some View {
        HStack(spacing: progressStreakCalendarColumnSpacing) {
            ForEach(self.week.days) { day in
                ProgressStreakDayCell(day: day, calendar: self.calendar)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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

private struct ProgressFreezeBankChip: View {
    let badgeState: ReviewProgressBadgeState
    let onShowInfo: () -> Void

    var body: some View {
        Button {
            self.onShowInfo()
        } label: {
            HStack(spacing: 4) {
                Image(systemName: reviewProgressFreezeBankSystemImageName())
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(progressFrozenStreakContentColor)

                Text(formatReviewProgressFreezeBankValue(badgeState: self.badgeState))
                    .font(.caption2.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(.primary)
                    .minimumScaleFactor(0.65)

                Image(systemName: "info.circle")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, progressStreakBadgeHorizontalPadding)
            .frame(minHeight: progressStreakBadgeSize)
            .background {
                Capsule()
                    .fill(Color(uiColor: .secondarySystemBackground))
            }
            .overlay {
                Capsule()
                    .strokeBorder(progressFrozenStreakBorderColor, lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
        .fixedSize(horizontal: true, vertical: false)
        .accessibilityLabel(self.accessibilityLabel)
        .accessibilityHint(
            String(
                localized: "progress.freeze_bank.info.accessibility_hint",
                defaultValue: "Shows how streak freezes work.",
                table: "Foundation",
                comment: "Accessibility hint for the streak freeze bank info button"
            )
        )
    }

    private var accessibilityLabel: String {
        let localizedFormat = String(
            localized: "progress.freeze_bank.accessibility",
            defaultValue: "Freeze bank %@ of %@ available.",
            table: "Foundation",
            comment: "Accessibility label for the current streak freeze credit bank"
        )
        return String(
            format: localizedFormat,
            locale: Locale.current,
            self.badgeState.streakFreezeAvailableCredits.formatted(),
            self.badgeState.streakFreezeCapacity.formatted()
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

            if self.isActiveFlameDay {
                Image(systemName: "flame.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(self.foregroundColor)
            } else if self.isFrozenDay {
                Image(systemName: reviewProgressFreezeBankSystemImageName())
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
        .accessibilityLabel(self.accessibilityLabel)
    }

    private var backgroundColor: Color {
        if self.day.isFuturePlaceholder {
            return Color.clear
        }

        if self.isActiveFlameDay {
            return .accentColor
        }

        if self.isFrozenDay {
            return .white
        }

        return Color(uiColor: .secondarySystemGroupedBackground)
    }

    private var borderColor: Color {
        if self.day.isFuturePlaceholder {
            return Color(uiColor: .separator).opacity(0.18)
        }

        if self.isActiveFlameDay {
            return .accentColor
        }

        if self.isFrozenDay {
            return progressFrozenStreakBorderColor
        }

        if self.day.isToday {
            return .accentColor
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

        if self.isFrozenDay {
            return progressFrozenStreakContentColor
        }

        if self.day.isToday {
            return .accentColor
        }

        return .primary
    }

    private var isActiveFlameDay: Bool {
        self.day.streakState == .reviewed
    }

    private var isFrozenDay: Bool {
        self.day.streakState == .frozen
    }

    private var borderLineWidth: CGFloat {
        self.day.isToday && self.isActiveFlameDay == false ? 2 : 1
    }

    private var accessibilityLabel: String {
        if self.day.isFuturePlaceholder {
            let dateTitle = progressCompleteDateLabel(date: self.day.date, calendar: self.calendar)
            let futureTitle = String(
                localized: "progress.screen.streak.future_day.accessibility",
                defaultValue: "Future day",
                table: "Foundation",
                comment: "Accessibility label component for a future streak calendar day"
            )

            return [dateTitle, futureTitle].joined(separator: ", ")
        }

        let dateTitle = progressCompleteDateLabel(date: self.day.date, calendar: self.calendar)
        let todayTitle = String(
            localized: "progress.screen.today",
            defaultValue: "Today",
            table: "Foundation",
            comment: "Progress today label"
        )
        let reviewsTitle = String.localizedStringWithFormat(
            String(
                localized: "progress.screen.reviews.accessibility",
                defaultValue: "%lld reviews",
                table: "Foundation",
                comment: "Accessibility label suffix for daily review counts"
            ),
            Int64(self.day.reviewCount)
        )
        let streakStateTitle: String?
        switch self.day.streakState {
        case .reviewed:
            streakStateTitle = nil
        case .frozen:
            streakStateTitle = String(
                localized: "progress.screen.streak.frozen_day.accessibility",
                defaultValue: "Frozen day",
                table: "Foundation",
                comment: "Accessibility label component for a streak day preserved by a freeze credit"
            )
        case .missed:
            streakStateTitle = nil
        case .pending:
            streakStateTitle = nil
        }

        if self.day.isToday {
            return [dateTitle, todayTitle, streakStateTitle, reviewsTitle]
                .compactMap { component in component }
                .joined(separator: ", ")
        }

        return [dateTitle, streakStateTitle, reviewsTitle]
            .compactMap { component in component }
            .joined(separator: ", ")
    }
}
