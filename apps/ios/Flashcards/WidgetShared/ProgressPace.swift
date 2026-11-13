import Foundation

// Port of apps/web/src/progress/reviewPace.ts, the reference definition; keep the platforms in step.
//
// Last 7 local days (today and the 6 before) against the daily average of the 28 days before them, rest days
// counting 0. A young account's baseline averages only the days on or after its first review. There is no baseline
// when history since the first review is under 14 days or the baseline window holds under 14 reviews. The ring is the
// same number drawn as laps.
let progressPaceWindowDayCount: Int = 7
let progressPaceBaselineDayCount: Int = 28
let progressPaceMinimumHistoryDayCount: Int = 14
let progressPaceMinimumBaselineReviewCount: Int = 14
let progressPaceMaximumPercentChange: Int = 999
let progressPaceMaximumRingLaps: Double = 2

struct ProgressPaceBaseline: Equatable, Sendable {
    let usualReviewsPerDay: Double
    /// Rounded, signed, at most 999; 0 means no arrow.
    let percentChange: Int
    /// Last 7 total ÷ (usual per day × 7), stopped at two laps.
    let ringProgress: Double
}

struct ProgressPace: Equatable, Sendable {
    let lastSevenDaysReviewCount: Int
    let lastSevenDaysAveragePerDay: Double
    let baseline: ProgressPaceBaseline?
}

/// `dayReviewCounts` holds one count per consecutive local day, ascending and ending today. The earliest reviewed
/// day stands for the first review, so pass the longest history available.
func makeProgressPace(dayReviewCounts: [Int]) -> ProgressPace {
    let lastSevenDaysReviewCount = dayReviewCounts.suffix(progressPaceWindowDayCount).reduce(0, +)
    let lastSevenDaysAveragePerDay = Double(lastSevenDaysReviewCount) / Double(progressPaceWindowDayCount)
    let noBaseline = ProgressPace(
        lastSevenDaysReviewCount: lastSevenDaysReviewCount,
        lastSevenDaysAveragePerDay: lastSevenDaysAveragePerDay,
        baseline: nil
    )
    guard
        let firstReviewIndex = dayReviewCounts.firstIndex(where: { reviewCount in reviewCount > 0 }),
        dayReviewCounts.count - firstReviewIndex >= progressPaceMinimumHistoryDayCount
    else {
        return noBaseline
    }

    let baselineEndIndex = dayReviewCounts.count - progressPaceWindowDayCount
    let baselineStartIndex = max(baselineEndIndex - progressPaceBaselineDayCount, firstReviewIndex)
    guard baselineEndIndex > baselineStartIndex else {
        return noBaseline
    }
    let baselineReviewCount = dayReviewCounts[baselineStartIndex ..< baselineEndIndex].reduce(0, +)
    guard baselineReviewCount >= progressPaceMinimumBaselineReviewCount else {
        return noBaseline
    }

    let usualReviewsPerDay = Double(baselineReviewCount) / Double(baselineEndIndex - baselineStartIndex)
    let ratio = lastSevenDaysAveragePerDay / usualReviewsPerDay
    // Half up, as JavaScript's Math.round in the reference.
    let roundedPercentChange = Int(((ratio - 1) * 100 + 0.5).rounded(.down))
    return ProgressPace(
        lastSevenDaysReviewCount: lastSevenDaysReviewCount,
        lastSevenDaysAveragePerDay: lastSevenDaysAveragePerDay,
        baseline: ProgressPaceBaseline(
            usualReviewsPerDay: usualReviewsPerDay,
            percentChange: min(roundedPercentChange, progressPaceMaximumPercentChange),
            ringProgress: min(ratio, progressPaceMaximumRingLaps)
        )
    )
}
