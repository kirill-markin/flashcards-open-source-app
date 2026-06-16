import Foundation

struct ProgressRequestRange: Hashable, Sendable {
    let timeZone: String
    let from: String
    let to: String
}

struct ReviewScheduleBucketBoundaries: Hashable, Sendable {
    let startOfTomorrowMillis: Int64
    let startOfDay8Millis: Int64
    let startOfDay31Millis: Int64
    let startOfDay91Millis: Int64
    let startOfDay361Millis: Int64
    let startOfDay721Millis: Int64
}

private struct ProgressLocalDateParts: Equatable, Sendable {
    let year: Int
    let month: Int
    let day: Int
}

private let progressAsciiZero: UInt8 = 48
private let progressAsciiNine: UInt8 = 57
private let progressAsciiHyphen: UInt8 = 45

let recentProgressHistoryDayCount: Int = 140
let progressStreakFreezePolicy = ProgressStreakFreezePolicy(
    startCapacity: 2,
    maxCapacity: 2,
    unitsPerCredit: 10,
    earnedUnitsPerStreakDay: 1
)

struct ProgressStreakFreezePolicy: Hashable, Sendable {
    let startCapacity: Int
    let maxCapacity: Int
    let unitsPerCredit: Int
    let earnedUnitsPerStreakDay: Int
}

struct ProgressStreakFreezeEvaluation: Hashable, Sendable {
    let currentStreakDays: Int
    let longestStreakDays: Int
    let streakFreeze: ProgressStreakFreeze
    let streakDays: [ProgressStreakDay]
}

private struct ProgressStreakComputationState: Hashable, Sendable {
    let balanceUnits: Int
    let currentStreakDays: Int
    let longestStreakDays: Int
    let hasActiveSegment: Bool
    let lastEvaluatedDate: String?
}

private struct ProgressStreakEvaluationAccumulator: Hashable, Sendable {
    let state: ProgressStreakComputationState
    let statesByDate: [String: ProgressStreakDayState]
}

func makeProgressRequestRange(
    now: Date,
    timeZone: TimeZone,
    dayCount: Int
) throws -> ProgressRequestRange {
    guard dayCount > 0 else {
        throw LocalStoreError.validation("Progress date range must include at least one day")
    }

    let calendar = makeProgressStoreCalendar(timeZone: timeZone)
    let endDate = calendar.startOfDay(for: now)
    guard let startDate = calendar.date(byAdding: .day, value: -(dayCount - 1), to: endDate) else {
        throw LocalStoreError.validation("Progress date range could not be calculated")
    }

    let formatter = DateFormatter()
    formatter.calendar = calendar
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = timeZone
    formatter.dateFormat = "yyyy-MM-dd"

    let timeZoneIdentifier = timeZone.identifier.trimmingCharacters(in: .whitespacesAndNewlines)
    if timeZoneIdentifier.isEmpty {
        throw LocalStoreError.validation("Current timezone identifier is unavailable")
    }

    return ProgressRequestRange(
        timeZone: timeZoneIdentifier,
        from: formatter.string(from: startDate),
        to: formatter.string(from: endDate)
    )
}

func progressRequestRange(scopeKey: ProgressScopeKey) -> ProgressRequestRange {
    ProgressRequestRange(
        timeZone: scopeKey.timeZone,
        from: scopeKey.from,
        to: scopeKey.to
    )
}

func makeReviewScheduleBucketBoundaries(
    referenceLocalDate: String,
    timeZone: TimeZone
) throws -> ReviewScheduleBucketBoundaries {
    let calendar = makeProgressStoreCalendar(timeZone: timeZone)
    let startOfToday = try progressDateForStore(localDate: referenceLocalDate, calendar: calendar)
    return ReviewScheduleBucketBoundaries(
        startOfTomorrowMillis: try reviewScheduleBoundaryMillis(
            startOfToday: startOfToday,
            offsetDays: 1,
            calendar: calendar
        ),
        startOfDay8Millis: try reviewScheduleBoundaryMillis(
            startOfToday: startOfToday,
            offsetDays: 8,
            calendar: calendar
        ),
        startOfDay31Millis: try reviewScheduleBoundaryMillis(
            startOfToday: startOfToday,
            offsetDays: 31,
            calendar: calendar
        ),
        startOfDay91Millis: try reviewScheduleBoundaryMillis(
            startOfToday: startOfToday,
            offsetDays: 91,
            calendar: calendar
        ),
        startOfDay361Millis: try reviewScheduleBoundaryMillis(
            startOfToday: startOfToday,
            offsetDays: 361,
            calendar: calendar
        ),
        startOfDay721Millis: try reviewScheduleBoundaryMillis(
            startOfToday: startOfToday,
            offsetDays: 721,
            calendar: calendar
        )
    )
}

func makeProgressStoreCalendar(timeZone: TimeZone) -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.locale = Locale(identifier: "en_US_POSIX")
    calendar.timeZone = timeZone
    return calendar
}

func progressTimeZone(identifier: String) throws -> TimeZone {
    guard let timeZone = TimeZone(identifier: identifier) else {
        throw LocalStoreError.validation("Progress timezone identifier is invalid: \(identifier)")
    }

    return timeZone
}

func evaluateProgressStreakFreeze(
    sortedActiveReviewLocalDates: [String],
    today: String,
    policy: ProgressStreakFreezePolicy
) throws -> ProgressStreakFreezeEvaluation {
    try validateProgressStreakFreezePolicy(policy: policy)
    try validateProgressStreakLocalDate(value: today, fieldName: "today")
    try validateSortedProgressStreakActiveReviewLocalDates(sortedActiveReviewLocalDates: sortedActiveReviewLocalDates)

    let activeReviewLocalDatesThroughToday: [String] = sortedActiveReviewLocalDates.filter { reviewDate in
        reviewDate <= today
    }
    let accumulatorAfterReviews = try activeReviewLocalDatesThroughToday.reduce(
        ProgressStreakEvaluationAccumulator(
            state: createInitialProgressStreakComputationState(policy: policy),
            statesByDate: [:]
        )
    ) { accumulator, reviewDate in
        let beforeReview = try addNonReviewedProgressStreakDaysBeforeReview(
            state: accumulator.state,
            nextReviewDate: reviewDate,
            policy: policy
        )
        var statesByDate: [String: ProgressStreakDayState] = accumulator.statesByDate
        for (date, state) in beforeReview.statesByDate {
            statesByDate[date] = state
        }
        statesByDate[reviewDate] = .reviewed

        return ProgressStreakEvaluationAccumulator(
            state: addReviewedProgressStreakDay(
                state: beforeReview.state,
                date: reviewDate,
                policy: policy
            ),
            statesByDate: statesByDate
        )
    }
    let finalState = try addTrailingProgressStreakDaysThroughToday(
        state: accumulatorAfterReviews.state,
        today: today,
        policy: policy
    )
    var statesByDate: [String: ProgressStreakDayState] = accumulatorAfterReviews.statesByDate
    for (date, state) in finalState.statesByDate {
        statesByDate[date] = state
    }

    return ProgressStreakFreezeEvaluation(
        currentStreakDays: finalState.state.currentStreakDays,
        longestStreakDays: finalState.state.longestStreakDays,
        streakFreeze: makeProgressStreakFreeze(
            balanceUnits: finalState.state.balanceUnits,
            policy: policy
        ),
        streakDays: makeProgressStreakDays(statesByDate: statesByDate)
    )
}

func makeProgressStreakDays(
    range: [String],
    activeReviewDates: Set<String>,
    evaluatedStreakDays: [ProgressStreakDay],
    today: String
) -> [ProgressStreakDay] {
    var evaluatedStatesByDate: [String: ProgressStreakDayState] = [:]
    for streakDay in evaluatedStreakDays {
        evaluatedStatesByDate[streakDay.date] = streakDay.state
    }

    return range.map { date in
        let state: ProgressStreakDayState
        if activeReviewDates.contains(date) {
            state = .reviewed
        } else if let evaluatedState = evaluatedStatesByDate[date] {
            state = evaluatedState
        } else if date >= today {
            state = .pending
        } else {
            state = .missed
        }

        return ProgressStreakDay(date: date, state: state)
    }
}

func validateProgressSummaryStreakContract(summary: ProgressSummary) throws {
    try validateProgressStreakFreeze(streakFreeze: summary.streakFreeze)

    guard summary.currentStreakDays >= 0 else {
        throw LocalStoreError.validation("Progress currentStreakDays must not be negative: \(summary.currentStreakDays)")
    }
    guard summary.longestStreakDays >= summary.currentStreakDays else {
        throw LocalStoreError.validation(
            """
            Progress longestStreakDays must be greater than or equal to currentStreakDays. \
            currentStreakDays=\(summary.currentStreakDays), longestStreakDays=\(summary.longestStreakDays).
            """
        )
    }
    guard summary.activeReviewDays >= 0 else {
        throw LocalStoreError.validation("Progress activeReviewDays must not be negative: \(summary.activeReviewDays)")
    }
    if let lastReviewedOn = summary.lastReviewedOn {
        try validateProgressStreakLocalDate(value: lastReviewedOn, fieldName: "lastReviewedOn")
    }
    guard summary.currentStreakDays == 0 || summary.lastReviewedOn != nil else {
        throw LocalStoreError.validation("Progress lastReviewedOn is required when currentStreakDays is positive")
    }
}

func validateProgressStreakFreeze(streakFreeze: ProgressStreakFreeze) throws {
    guard streakFreeze.availableCredits >= 0 else {
        throw LocalStoreError.validation(
            "Progress streakFreeze.availableCredits must not be negative: \(streakFreeze.availableCredits)"
        )
    }
    guard streakFreeze.capacity >= 0 else {
        throw LocalStoreError.validation("Progress streakFreeze.capacity must not be negative: \(streakFreeze.capacity)")
    }
    guard streakFreeze.availableCredits <= streakFreeze.capacity else {
        throw LocalStoreError.validation(
            """
            Progress streakFreeze.availableCredits must not exceed capacity. \
            availableCredits=\(streakFreeze.availableCredits), capacity=\(streakFreeze.capacity).
            """
        )
    }
    guard streakFreeze.balanceUnits >= 0 else {
        throw LocalStoreError.validation(
            "Progress streakFreeze.balanceUnits must not be negative: \(streakFreeze.balanceUnits)"
        )
    }
    guard streakFreeze.unitsPerCredit > 0 else {
        throw LocalStoreError.validation(
            "Progress streakFreeze.unitsPerCredit must be positive: \(streakFreeze.unitsPerCredit)"
        )
    }
    guard streakFreeze.earnedUnitsPerStreakDay >= 0 else {
        throw LocalStoreError.validation(
            """
            Progress streakFreeze.earnedUnitsPerStreakDay must not be negative: \
            \(streakFreeze.earnedUnitsPerStreakDay).
            """
        )
    }
    guard streakFreeze.nextCreditProgressUnits >= 0 else {
        throw LocalStoreError.validation(
            """
            Progress streakFreeze.nextCreditProgressUnits must not be negative: \
            \(streakFreeze.nextCreditProgressUnits).
            """
        )
    }
    guard streakFreeze.nextCreditRequiredUnits > 0 else {
        throw LocalStoreError.validation(
            """
            Progress streakFreeze.nextCreditRequiredUnits must be positive: \
            \(streakFreeze.nextCreditRequiredUnits).
            """
        )
    }
    guard streakFreeze.nextCreditRequiredUnits == streakFreeze.unitsPerCredit else {
        throw LocalStoreError.validation(
            """
            Progress streakFreeze.nextCreditRequiredUnits must match unitsPerCredit. \
            expected=\(streakFreeze.unitsPerCredit), actual=\(streakFreeze.nextCreditRequiredUnits).
            """
        )
    }
    let maximumBalanceUnits = try maximumProgressStreakBalanceUnits(
        capacity: streakFreeze.capacity,
        unitsPerCredit: streakFreeze.unitsPerCredit
    )
    guard streakFreeze.balanceUnits <= maximumBalanceUnits else {
        throw LocalStoreError.validation(
            """
            Progress streakFreeze.balanceUnits must not exceed capacity times unitsPerCredit. \
            balanceUnits=\(streakFreeze.balanceUnits), maximum=\(maximumBalanceUnits).
            """
        )
    }

    let expectedAvailableCredits = availableProgressStreakFreezeCredits(
        balanceUnits: streakFreeze.balanceUnits,
        capacity: streakFreeze.capacity,
        unitsPerCredit: streakFreeze.unitsPerCredit
    )
    guard streakFreeze.availableCredits == expectedAvailableCredits else {
        throw LocalStoreError.validation(
            """
            Progress streakFreeze.availableCredits must match balanceUnits and unitsPerCredit. \
            expected=\(expectedAvailableCredits), actual=\(streakFreeze.availableCredits), \
            balanceUnits=\(streakFreeze.balanceUnits), unitsPerCredit=\(streakFreeze.unitsPerCredit).
            """
        )
    }

    let expectedNextCreditProgressUnits = streakFreeze.availableCredits >= streakFreeze.capacity
        ? 0
        : streakFreeze.balanceUnits % streakFreeze.unitsPerCredit
    guard streakFreeze.nextCreditProgressUnits == expectedNextCreditProgressUnits else {
        throw LocalStoreError.validation(
            """
            Progress streakFreeze.nextCreditProgressUnits must match balanceUnits and capacity. \
            expected=\(expectedNextCreditProgressUnits), actual=\(streakFreeze.nextCreditProgressUnits).
            """
        )
    }
}

private func validateProgressStreakFreezePolicy(policy: ProgressStreakFreezePolicy) throws {
    guard policy.startCapacity >= 0 else {
        throw LocalStoreError.validation("Progress streak freeze startCapacity must be non-negative")
    }
    guard policy.maxCapacity >= 0 else {
        throw LocalStoreError.validation("Progress streak freeze maxCapacity must be non-negative")
    }
    guard policy.unitsPerCredit > 0 else {
        throw LocalStoreError.validation("Progress streak freeze unitsPerCredit must be positive")
    }
    guard policy.earnedUnitsPerStreakDay >= 0 else {
        throw LocalStoreError.validation("Progress streak freeze earnedUnitsPerStreakDay must be non-negative")
    }
}

private func validateProgressStreakLocalDate(value: String, fieldName: String) throws {
    guard let utcTimeZone = TimeZone(secondsFromGMT: 0) else {
        throw LocalStoreError.validation("Progress UTC timezone is unavailable")
    }

    let calendar = makeProgressStoreCalendar(timeZone: utcTimeZone)
    do {
        _ = try progressDateForStore(localDate: value, calendar: calendar)
    } catch {
        throw LocalStoreError.validation("Progress streak \(fieldName) must be a valid YYYY-MM-DD date: \(value)")
    }
}

private func validateSortedProgressStreakActiveReviewLocalDates(
    sortedActiveReviewLocalDates: [String]
) throws {
    var previousDate: String?
    for reviewDate in sortedActiveReviewLocalDates {
        try validateProgressStreakLocalDate(value: reviewDate, fieldName: "active review local date")
        if let previousDate,
           previousDate >= reviewDate {
            throw LocalStoreError.validation("Progress active review local dates must be sorted ascending without duplicates")
        }

        previousDate = reviewDate
    }
}

private func maximumProgressStreakBalanceUnits(policy: ProgressStreakFreezePolicy) -> Int {
    policy.maxCapacity * policy.unitsPerCredit
}

private func maximumProgressStreakBalanceUnits(
    capacity: Int,
    unitsPerCredit: Int
) throws -> Int {
    guard capacity <= Int.max / unitsPerCredit else {
        throw LocalStoreError.validation(
            """
            Progress streakFreeze capacity and unitsPerCredit are too large to multiply. \
            capacity=\(capacity), unitsPerCredit=\(unitsPerCredit).
            """
        )
    }

    return capacity * unitsPerCredit
}

private func initialProgressStreakBalanceUnits(policy: ProgressStreakFreezePolicy) -> Int {
    min(policy.startCapacity, policy.maxCapacity) * policy.unitsPerCredit
}

private func clampedProgressStreakBalanceUnits(
    balanceUnits: Int,
    policy: ProgressStreakFreezePolicy
) -> Int {
    min(balanceUnits, maximumProgressStreakBalanceUnits(policy: policy))
}

private func addProgressStreakDayEarnedUnits(
    balanceUnits: Int,
    policy: ProgressStreakFreezePolicy
) -> Int {
    clampedProgressStreakBalanceUnits(
        balanceUnits: balanceUnits + policy.earnedUnitsPerStreakDay,
        policy: policy
    )
}

private func availableProgressStreakFreezeCredits(
    balanceUnits: Int,
    policy: ProgressStreakFreezePolicy
) -> Int {
    availableProgressStreakFreezeCredits(
        balanceUnits: balanceUnits,
        capacity: policy.maxCapacity,
        unitsPerCredit: policy.unitsPerCredit
    )
}

private func availableProgressStreakFreezeCredits(
    balanceUnits: Int,
    capacity: Int,
    unitsPerCredit: Int
) -> Int {
    min(capacity, balanceUnits / unitsPerCredit)
}

private func makeProgressStreakFreeze(
    balanceUnits: Int,
    policy: ProgressStreakFreezePolicy
) -> ProgressStreakFreeze {
    let clampedBalanceUnits: Int = clampedProgressStreakBalanceUnits(balanceUnits: balanceUnits, policy: policy)
    return makeProgressStreakFreeze(
        balanceUnits: clampedBalanceUnits,
        capacity: policy.maxCapacity,
        unitsPerCredit: policy.unitsPerCredit,
        earnedUnitsPerStreakDay: policy.earnedUnitsPerStreakDay
    )
}

private func makeProgressStreakFreeze(
    balanceUnits: Int,
    capacity: Int,
    unitsPerCredit: Int,
    earnedUnitsPerStreakDay: Int
) -> ProgressStreakFreeze {
    let availableCredits: Int = availableProgressStreakFreezeCredits(
        balanceUnits: balanceUnits,
        capacity: capacity,
        unitsPerCredit: unitsPerCredit
    )
    return ProgressStreakFreeze(
        availableCredits: availableCredits,
        capacity: capacity,
        balanceUnits: balanceUnits,
        unitsPerCredit: unitsPerCredit,
        earnedUnitsPerStreakDay: earnedUnitsPerStreakDay,
        nextCreditProgressUnits: availableCredits >= capacity ? 0 : balanceUnits % unitsPerCredit,
        nextCreditRequiredUnits: unitsPerCredit
    )
}

func progressStreakFreezeAfterEarningStreakDay(streakFreeze: ProgressStreakFreeze) throws -> ProgressStreakFreeze {
    try validateProgressStreakFreeze(streakFreeze: streakFreeze)
    let maximumBalanceUnits = try maximumProgressStreakBalanceUnits(
        capacity: streakFreeze.capacity,
        unitsPerCredit: streakFreeze.unitsPerCredit
    )
    guard streakFreeze.balanceUnits <= Int.max - streakFreeze.earnedUnitsPerStreakDay else {
        throw LocalStoreError.validation(
            """
            Progress streakFreeze balanceUnits and earnedUnitsPerStreakDay are too large to add. \
            balanceUnits=\(streakFreeze.balanceUnits), earnedUnitsPerStreakDay=\(streakFreeze.earnedUnitsPerStreakDay).
            """
        )
    }

    return makeProgressStreakFreeze(
        balanceUnits: min(streakFreeze.balanceUnits + streakFreeze.earnedUnitsPerStreakDay, maximumBalanceUnits),
        capacity: streakFreeze.capacity,
        unitsPerCredit: streakFreeze.unitsPerCredit,
        earnedUnitsPerStreakDay: streakFreeze.earnedUnitsPerStreakDay
    )
}

private func createInitialProgressStreakComputationState(
    policy: ProgressStreakFreezePolicy
) -> ProgressStreakComputationState {
    ProgressStreakComputationState(
        balanceUnits: initialProgressStreakBalanceUnits(policy: policy),
        currentStreakDays: 0,
        longestStreakDays: 0,
        hasActiveSegment: false,
        lastEvaluatedDate: nil
    )
}

private func addReviewedProgressStreakDay(
    state: ProgressStreakComputationState,
    date: String,
    policy: ProgressStreakFreezePolicy
) -> ProgressStreakComputationState {
    let baseBalanceUnits: Int = state.hasActiveSegment
        ? state.balanceUnits
        : initialProgressStreakBalanceUnits(policy: policy)
    let balanceUnits: Int = addProgressStreakDayEarnedUnits(
        balanceUnits: baseBalanceUnits,
        policy: policy
    )
    let currentStreakDays: Int = state.hasActiveSegment ? state.currentStreakDays + 1 : 1
    return ProgressStreakComputationState(
        balanceUnits: balanceUnits,
        currentStreakDays: currentStreakDays,
        longestStreakDays: max(state.longestStreakDays, currentStreakDays),
        hasActiveSegment: true,
        lastEvaluatedDate: date
    )
}

private func addFrozenProgressStreakDay(
    state: ProgressStreakComputationState,
    date: String,
    policy: ProgressStreakFreezePolicy
) -> ProgressStreakComputationState {
    let balanceUnitsAfterSpend: Int = state.balanceUnits - policy.unitsPerCredit
    let balanceUnits: Int = addProgressStreakDayEarnedUnits(
        balanceUnits: balanceUnitsAfterSpend,
        policy: policy
    )
    let currentStreakDays: Int = state.currentStreakDays + 1
    return ProgressStreakComputationState(
        balanceUnits: balanceUnits,
        currentStreakDays: currentStreakDays,
        longestStreakDays: max(state.longestStreakDays, currentStreakDays),
        hasActiveSegment: true,
        lastEvaluatedDate: date
    )
}

private func addMissedProgressStreakDay(
    state: ProgressStreakComputationState,
    date: String,
    policy: ProgressStreakFreezePolicy
) -> ProgressStreakComputationState {
    ProgressStreakComputationState(
        balanceUnits: initialProgressStreakBalanceUnits(policy: policy),
        currentStreakDays: 0,
        longestStreakDays: state.longestStreakDays,
        hasActiveSegment: false,
        lastEvaluatedDate: date
    )
}

private func addPendingProgressStreakDay(
    state: ProgressStreakComputationState,
    date: String
) -> ProgressStreakComputationState {
    ProgressStreakComputationState(
        balanceUnits: state.balanceUnits,
        currentStreakDays: state.currentStreakDays,
        longestStreakDays: state.longestStreakDays,
        hasActiveSegment: state.hasActiveSegment,
        lastEvaluatedDate: date
    )
}

private func addNonReviewedCompletedProgressStreakDay(
    state: ProgressStreakComputationState,
    date: String,
    policy: ProgressStreakFreezePolicy
) -> (state: ProgressStreakComputationState, stateByDate: ProgressStreakDayState) {
    if state.hasActiveSegment,
       availableProgressStreakFreezeCredits(balanceUnits: state.balanceUnits, policy: policy) > 0 {
        return (
            state: addFrozenProgressStreakDay(state: state, date: date, policy: policy),
            stateByDate: .frozen
        )
    }

    return (
        state: addMissedProgressStreakDay(state: state, date: date, policy: policy),
        stateByDate: .missed
    )
}

private func addNonReviewedProgressStreakDaysBeforeReview(
    state: ProgressStreakComputationState,
    nextReviewDate: String,
    policy: ProgressStreakFreezePolicy
) throws -> (state: ProgressStreakComputationState, statesByDate: [String: ProgressStreakDayState]) {
    var currentState: ProgressStreakComputationState = state
    var statesByDate: [String: ProgressStreakDayState] = [:]
    let initialCurrentDate: String
    if let lastEvaluatedDate = currentState.lastEvaluatedDate {
        initialCurrentDate = try progressShiftLocalDateForStore(value: lastEvaluatedDate, offsetDays: 1)
    } else {
        initialCurrentDate = nextReviewDate
    }
    var currentDate: String = initialCurrentDate

    while currentState.lastEvaluatedDate != nil && currentDate < nextReviewDate {
        let result = addNonReviewedCompletedProgressStreakDay(
            state: currentState,
            date: currentDate,
            policy: policy
        )
        currentState = result.state
        statesByDate[currentDate] = result.stateByDate
        currentDate = try progressShiftLocalDateForStore(value: currentDate, offsetDays: 1)
    }

    return (state: currentState, statesByDate: statesByDate)
}

private func addTrailingProgressStreakDaysThroughToday(
    state: ProgressStreakComputationState,
    today: String,
    policy: ProgressStreakFreezePolicy
) throws -> (state: ProgressStreakComputationState, statesByDate: [String: ProgressStreakDayState]) {
    var currentState: ProgressStreakComputationState = state
    var statesByDate: [String: ProgressStreakDayState] = [:]
    let initialCurrentDate: String
    if let lastEvaluatedDate = currentState.lastEvaluatedDate {
        initialCurrentDate = try progressShiftLocalDateForStore(value: lastEvaluatedDate, offsetDays: 1)
    } else {
        initialCurrentDate = today
    }
    var currentDate: String = initialCurrentDate

    while currentDate <= today {
        if currentDate == today {
            currentState = addPendingProgressStreakDay(state: currentState, date: currentDate)
            statesByDate[currentDate] = .pending
        } else {
            let result = addNonReviewedCompletedProgressStreakDay(
                state: currentState,
                date: currentDate,
                policy: policy
            )
            currentState = result.state
            statesByDate[currentDate] = result.stateByDate
        }

        currentDate = try progressShiftLocalDateForStore(value: currentDate, offsetDays: 1)
    }

    return (state: currentState, statesByDate: statesByDate)
}

private func makeProgressStreakDays(
    statesByDate: [String: ProgressStreakDayState]
) -> [ProgressStreakDay] {
    statesByDate.keys.sorted().map { date in
        ProgressStreakDay(
            date: date,
            state: statesByDate[date] ?? .missed
        )
    }
}

func makeZeroFilledProgressDays(requestRange: ProgressRequestRange) throws -> [ProgressDay] {
    let timeZone = try progressTimeZone(identifier: requestRange.timeZone)
    let calendar = makeProgressStoreCalendar(timeZone: timeZone)
    let startDate = try progressDateForStore(localDate: requestRange.from, calendar: calendar)
    let endDate = try progressDateForStore(localDate: requestRange.to, calendar: calendar)

    var progressDays: [ProgressDay] = []
    var currentDate = startDate
    while currentDate <= endDate {
        progressDays.append(
            ProgressDay(
                date: progressLocalDateStringForStore(date: currentDate, calendar: calendar),
                reviewCount: 0,
                againCount: 0,
                hardCount: 0,
                goodCount: 0,
                easyCount: 0
            )
        )

        guard let nextDate = calendar.date(byAdding: .day, value: 1, to: currentDate) else {
            throw LocalStoreError.validation("Progress date range could not be advanced")
        }

        currentDate = nextDate
    }

    return progressDays
}

func progressShiftLocalDateForStore(value: String, offsetDays: Int) throws -> String {
    guard let utcTimeZone = TimeZone(secondsFromGMT: 0) else {
        throw LocalStoreError.validation("Progress UTC timezone is unavailable")
    }

    let calendar = makeProgressStoreCalendar(timeZone: utcTimeZone)
    let parsedDate = try progressDateForStore(localDate: value, calendar: calendar)
    guard let shiftedDate = calendar.date(byAdding: .day, value: offsetDays, to: parsedDate) else {
        throw LocalStoreError.validation("Progress local date could not be shifted: \(value)")
    }

    return progressLocalDateStringForStore(date: shiftedDate, calendar: calendar)
}

func progressReferenceDate(
    localDate: String,
    timeZoneIdentifier: String
) throws -> Date {
    let timeZone = try progressTimeZone(identifier: timeZoneIdentifier)
    let calendar = makeProgressStoreCalendar(timeZone: timeZone)
    return try progressDateForStore(localDate: localDate, calendar: calendar)
}

func progressLocalDateStringForStore(date: Date, calendar: Calendar) -> String {
    let components = calendar.dateComponents([.year, .month, .day], from: date)
    guard
        let year = components.year,
        let month = components.month,
        let day = components.day
    else {
        preconditionFailure("Progress local date components are unavailable")
    }

    return String(format: "%04d-%02d-%02d", year, month, day)
}

func progressDateForStore(localDate: String, calendar: Calendar) throws -> Date {
    guard let date = progressStrictDate(localDate: localDate, calendar: calendar) else {
        throw LocalStoreError.validation("Progress local date is invalid: \(localDate)")
    }

    return date
}

func progressStrictDate(localDate: String, calendar: Calendar) -> Date? {
    guard let parts = progressLocalDateParts(localDate: localDate) else {
        return nil
    }

    return progressStrictDate(parts: parts, calendar: calendar)
}

private func progressLocalDateParts(localDate: String) -> ProgressLocalDateParts? {
    let utf8Bytes: [UInt8] = Array(localDate.utf8)

    guard
        progressLocalDateHasCanonicalShape(utf8Bytes: utf8Bytes),
        let year = progressLocalDateComponentValue(utf8Bytes: utf8Bytes[0 ..< 4]),
        let month = progressLocalDateComponentValue(utf8Bytes: utf8Bytes[5 ..< 7]),
        let day = progressLocalDateComponentValue(utf8Bytes: utf8Bytes[8 ..< 10])
    else {
        return nil
    }

    return ProgressLocalDateParts(year: year, month: month, day: day)
}

private func progressLocalDateHasCanonicalShape(utf8Bytes: [UInt8]) -> Bool {
    guard
        utf8Bytes.count == 10,
        utf8Bytes[4] == progressAsciiHyphen,
        utf8Bytes[7] == progressAsciiHyphen
    else {
        return false
    }

    return true
}

private func progressLocalDateComponentValue(utf8Bytes: ArraySlice<UInt8>) -> Int? {
    var value: Int = 0
    for byte in utf8Bytes {
        guard byte >= progressAsciiZero && byte <= progressAsciiNine else {
            return nil
        }

        value = (value * 10) + Int(byte - progressAsciiZero)
    }

    return value
}

private func progressStrictDate(parts: ProgressLocalDateParts, calendar: Calendar) -> Date? {
    guard let date = calendar.date(
        from: DateComponents(
            calendar: calendar,
            timeZone: calendar.timeZone,
            year: parts.year,
            month: parts.month,
            day: parts.day
        )
    ) else {
        return nil
    }

    let normalizedParts = calendar.dateComponents([.year, .month, .day], from: date)
    guard
        normalizedParts.year == parts.year,
        normalizedParts.month == parts.month,
        normalizedParts.day == parts.day
    else {
        return nil
    }

    return calendar.startOfDay(for: date)
}

private func reviewScheduleBoundaryMillis(
    startOfToday: Date,
    offsetDays: Int,
    calendar: Calendar
) throws -> Int64 {
    guard let boundaryDate = calendar.date(byAdding: .day, value: offsetDays, to: startOfToday) else {
        throw LocalStoreError.validation("Review schedule boundary could not be calculated")
    }

    return epochMillis(date: boundaryDate)
}
