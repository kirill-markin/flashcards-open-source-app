import Foundation

/**
 Full FSRS scheduler with persisted card state and workspace-level settings.

 This file is a full Swift copy of the scheduler implemented in
 `apps/backend/src/schedule.ts`.
 If you change algorithm behavior here, you must make the same change in the
 backend copy, update `docs/fsrs-scheduling-logic.md`, and keep
 `tests/fsrs-full-vectors.json` plus both scheduler test suites aligned in the
 same PR.

 Reference sources:
 - official open-spaced-repetition ts-fsrs 5.2.3 scheduler flow mirrored here:
   https://github.com/open-spaced-repetition/ts-fsrs
 - official FSRS algorithm notes:
   https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm
 - product source of truth: docs/fsrs-scheduling-logic.md
 */

// Keep in sync with apps/backend/src/schedule.ts::ReviewableCardScheduleState.
struct ReviewableCardScheduleState: Hashable {
    let cardId: String
    let reps: Int
    let lapses: Int
    let fsrsCardState: FsrsCardState
    let fsrsStepIndex: Int?
    let fsrsStability: Double?
    let fsrsDifficulty: Double?
    let fsrsLastReviewedAt: Date?
    let fsrsScheduledDays: Int?
}

// Keep in sync with apps/backend/src/schedule.ts::ReviewHistoryEvent.
struct FsrsReviewHistoryEvent: Hashable {
    let rating: ReviewRating
    let reviewedAt: Date
}

// Keep in sync with apps/backend/src/schedule.ts::RebuiltCardScheduleState.
struct RebuiltCardScheduleState: Hashable {
    let dueAt: Date?
    let reps: Int
    let lapses: Int
    let fsrsCardState: FsrsCardState
    let fsrsStepIndex: Int?
    let fsrsStability: Double?
    let fsrsDifficulty: Double?
    let fsrsLastReviewedAt: Date?
    let fsrsScheduledDays: Int?
}

// Keep in sync with apps/backend/src/schedule.ts::FsrsMemoryState.
private struct FsrsMemoryState: Hashable {
    let difficulty: Double
    let stability: Double
}

// Keep in sync with apps/backend/src/schedule.ts::FuzzRange.
private struct FuzzRange: Hashable {
    let minInterval: Int
    let maxInterval: Int
}

// Keep in sync with apps/backend/src/schedule.ts::LearningStepResult.
private struct LearningStepResult: Hashable {
    let scheduledMinutes: Int?
    let nextStepIndex: Int
}

private let posixLocale = Locale(identifier: "en_US_POSIX")

// Keep in sync with apps/backend/src/schedule.ts::roundTo8.
func roundTo8(value: Double) -> Double {
    let formattedValue = String(format: "%.8f", locale: posixLocale, arguments: [value])
    guard let roundedValue = Double(formattedValue) else {
        preconditionFailure("Failed to parse 8-digit rounded value")
    }

    return roundedValue
}

// Keep in sync with apps/backend/src/schedule.ts::DEFAULT_W.
private let defaultWeights: [Double] = [
    0.212,
    1.2931,
    2.3065,
    8.2956,
    6.4133,
    0.8334,
    3.0194,
    0.001,
    1.8722,
    0.1666,
    0.796,
    1.4835,
    0.0614,
    0.2629,
    1.6483,
    0.6014,
    1.8729,
    0.5425,
    0.0912,
    0.0658,
    0.1542
]

// Keep in sync with apps/backend/src/schedule.ts::S_MIN.
private let fsrsMinimumStability: Double = 0.001
// Keep in sync with apps/backend/src/schedule.ts::W17_W18_CEILING.
private let W17_W18_CEILING: Double = 2
// Keep in sync with apps/backend/src/schedule.ts::FUZZ_RANGES.
private let fuzzRanges: [(start: Double, end: Double, factor: Double)] = [
    (start: 2.5, end: 7.0, factor: 0.15),
    (start: 7.0, end: 20.0, factor: 0.1),
    (start: 20.0, end: .infinity, factor: 0.05)
]
// Keep in sync with apps/backend/src/schedule.ts::DECAY.
private let fsrsDecay: Double = -defaultWeights[20]
// Keep in sync with apps/backend/src/schedule.ts::FACTOR.
private let fsrsFactor: Double = roundTo8(
    value: Foundation.exp(Foundation.pow(fsrsDecay, -1) * Foundation.log(0.9)) - 1
)

// Keep in sync with apps/backend/src/schedule.ts::createMash and the returned mash closure state.
private struct MashGenerator {
    private var n: Double = 0xefc8249d

    // Keep in sync with apps/backend/src/schedule.ts::createMash.
    mutating func next(data: String) -> Double {
        var nextValue = self.n

        for scalar in data.unicodeScalars {
            nextValue += Double(scalar.value)
            var h = 0.02519603282416938 * nextValue
            nextValue = Foundation.floor(h)
            h -= nextValue
            h *= nextValue
            nextValue = Foundation.floor(h)
            h -= nextValue
            nextValue += h * 4_294_967_296.0
        }

        self.n = nextValue
        let normalized = Foundation.floor(nextValue).truncatingRemainder(dividingBy: 4_294_967_296.0)
        return normalized * 2.3283064365386963e-10
    }
}

// Keep in sync with apps/backend/src/schedule.ts::Alea.
private struct AleaGenerator {
    private var c: Double
    private var s0: Double
    private var s1: Double
    private var s2: Double

    // Keep in sync with apps/backend/src/schedule.ts::Alea.constructor.
    init(seed: String) {
        var mash = MashGenerator()
        self.c = 1
        self.s0 = mash.next(data: " ")
        self.s1 = mash.next(data: " ")
        self.s2 = mash.next(data: " ")

        self.s0 -= mash.next(data: seed)
        if self.s0 < 0 {
            self.s0 += 1
        }

        self.s1 -= mash.next(data: seed)
        if self.s1 < 0 {
            self.s1 += 1
        }

        self.s2 -= mash.next(data: seed)
        if self.s2 < 0 {
            self.s2 += 1
        }
    }

    // Keep in sync with apps/backend/src/schedule.ts::Alea.next.
    mutating func next() -> Double {
        let nextValue = 2_091_639.0 * self.s0 + self.c * 2.3283064365386963e-10
        self.s0 = self.s1
        self.s1 = self.s2
        self.c = Foundation.floor(nextValue)
        self.s2 = nextValue - self.c
        return self.s2
    }
}

// Keep in sync with apps/backend/src/schedule.ts::clamp.
private func clamp(value: Double, min minimum: Double, max maximum: Double) -> Double {
    min(max(value, minimum), maximum)
}

// Keep in sync with apps/backend/src/schedule.ts::dateDiffInDays.
private func dateDiffInDays(lastReviewedAt: Date, now: Date) throws -> Int {
    if now < lastReviewedAt {
        throw LocalStoreError.database(
            "Review timestamp moved backwards: lastReviewedAt=\(formatIsoTimestamp(date: lastReviewedAt)), now=\(formatIsoTimestamp(date: now))"
        )
    }

    let utcCalendar = makeUtcGregorianCalendar()
    let startOfLastDay = utcCalendar.startOfDay(for: lastReviewedAt)
    let startOfCurrentDay = utcCalendar.startOfDay(for: now)

    let components = utcCalendar.dateComponents([.day], from: startOfLastDay, to: startOfCurrentDay)
    return components.day ?? 0
}

// Keep in sync with apps/backend/src/schedule.ts::stateRequiresMemory.
private func stateRequiresMemory(state: FsrsCardState) -> Bool {
    state != .new
}

// Keep in sync with apps/backend/src/schedule.ts::dateDiffInDays UTC calendar-day boundary logic.
private func makeUtcGregorianCalendar() -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    return calendar
}

// Keep in sync with apps/backend/src/schedule.ts::getIntervalModifier.
private func getIntervalModifier(requestRetention: Double) -> Double {
    roundTo8(value: (Foundation.pow(requestRetention, 1 / fsrsDecay) - 1) / fsrsFactor)
}

// Keep in sync with apps/backend/src/schedule.ts::formatSeedNumber.
private func formatSeedNumber(value: Double) -> String {
    if value == 0 {
        return "0"
    }

    if value.rounded(.towardZero) == value {
        return String(Int64(value))
    }

    return String(value)
}

// Keep in sync with apps/backend/src/schedule.ts::mapRatingToFsrsGrade.
private func mapRatingToFsrsGrade(rating: ReviewRating) -> Int {
    rating.rawValue + 1
}

// Keep in sync with apps/backend/src/schedule.ts::getStepsForState.
private func getStepsForState(
    settings: WorkspaceSchedulerSettings,
    state: FsrsCardState
) -> [Int] {
    if state == .relearning || state == .review {
        return settings.relearningStepsMinutes
    }

    return settings.learningStepsMinutes
}

// Keep in sync with apps/backend/src/schedule.ts::getCurrentStepIndex.
private func getCurrentStepIndex(card: ReviewableCardScheduleState) -> Int {
    card.fsrsStepIndex ?? 0
}

// Keep in sync with apps/backend/src/schedule.ts::getLearningStrategyStepIndex.
private func getLearningStrategyStepIndex(
    card: ReviewableCardScheduleState,
    grade: Int
) -> Int {
    let currentStepIndex = getCurrentStepIndex(card: card)
    if card.fsrsCardState == .learning && grade != 1 && grade != 2 {
        return currentStepIndex + 1
    }

    return currentStepIndex
}

// Keep in sync with apps/backend/src/schedule.ts::getHardStepMinutes.
private func getHardStepMinutes(steps: [Int]) -> Int {
    if steps.count == 1 {
        return Int((Double(steps[0]) * 1.5).rounded())
    }

    return Int((Double(steps[0] + steps[1]) / 2).rounded())
}

// Keep in sync with apps/backend/src/schedule.ts::getLearningStepResult.
private func getLearningStepResult(
    settings: WorkspaceSchedulerSettings,
    card: ReviewableCardScheduleState,
    grade: Int
) throws -> LearningStepResult {
    let steps = getStepsForState(settings: settings, state: card.fsrsCardState)
    let strategyStepIndex = getLearningStrategyStepIndex(card: card, grade: grade)

    if steps.isEmpty {
        throw LocalStoreError.validation("Workspace scheduler steps must not be empty")
    }

    if card.fsrsCardState == .review {
        return LearningStepResult(
            scheduledMinutes: steps[0],
            nextStepIndex: 0
        )
    }

    if grade == 1 {
        return LearningStepResult(
            scheduledMinutes: steps[0],
            nextStepIndex: 0
        )
    }

    if grade == 2 {
        return LearningStepResult(
            scheduledMinutes: getHardStepMinutes(steps: steps),
            nextStepIndex: strategyStepIndex
        )
    }

    if grade == 4 {
        return LearningStepResult(
            scheduledMinutes: nil,
            nextStepIndex: 0
        )
    }

    let nextStepIndex = strategyStepIndex + 1
    if nextStepIndex >= steps.count {
        return LearningStepResult(
            scheduledMinutes: nil,
            nextStepIndex: 0
        )
    }

    return LearningStepResult(
        scheduledMinutes: steps[nextStepIndex],
        nextStepIndex: nextStepIndex
    )
}

// Keep in sync with apps/backend/src/schedule.ts::initStability.
private func initStability(grade: Int) -> Double {
    max(defaultWeights[grade - 1], 0.1)
}

// Keep in sync with apps/backend/src/schedule.ts::initDifficulty.
private func initDifficulty(grade: Int) -> Double {
    roundTo8(value: defaultWeights[4] - Foundation.exp(Double(grade - 1) * defaultWeights[5]) + 1)
}

// Keep in sync with apps/backend/src/schedule.ts::meanReversion.
private func meanReversion(initialDifficulty: Double, currentDifficulty: Double) -> Double {
    roundTo8(value: defaultWeights[7] * initialDifficulty + (1 - defaultWeights[7]) * currentDifficulty)
}

// Keep in sync with apps/backend/src/schedule.ts::linearDamping.
private func linearDamping(deltaDifficulty: Double, difficulty: Double) -> Double {
    roundTo8(value: deltaDifficulty * (10 - difficulty) / 9)
}

// Keep in sync with apps/backend/src/schedule.ts::nextDifficulty.
private func nextDifficulty(difficulty: Double, grade: Int) -> Double {
    let deltaDifficulty = -defaultWeights[6] * Double(grade - 3)
    let nextDifficultyValue = difficulty + linearDamping(deltaDifficulty: deltaDifficulty, difficulty: difficulty)
    return clamp(
        value: meanReversion(initialDifficulty: initDifficulty(grade: 4), currentDifficulty: nextDifficultyValue),
        min: 1,
        max: 10
    )
}

// Keep in sync with apps/backend/src/schedule.ts::forgettingCurve.
private func forgettingCurve(elapsedDays: Int, stability: Double) -> Double {
    roundTo8(value: Foundation.pow(1 + fsrsFactor * Double(elapsedDays) / stability, fsrsDecay))
}

// Keep in sync with apps/backend/src/schedule.ts::nextRecallStability.
private func nextRecallStability(
    difficulty: Double,
    stability: Double,
    retrievability: Double,
    grade: Int
) -> Double {
    let hardPenalty = grade == 2 ? defaultWeights[15] : 1.0
    let easyBound = grade == 4 ? defaultWeights[16] : 1.0
    let nextValue = stability * (
        1
        + Foundation.exp(defaultWeights[8])
        * (11 - difficulty)
        * Foundation.pow(stability, -defaultWeights[9])
        * (Foundation.exp((1 - retrievability) * defaultWeights[10]) - 1)
        * hardPenalty
        * easyBound
    )

    return roundTo8(value: clamp(value: nextValue, min: fsrsMinimumStability, max: 36_500))
}

// Keep in sync with apps/backend/src/schedule.ts::nextForgetStability.
private func nextForgetStability(
    difficulty: Double,
    stability: Double,
    retrievability: Double
) -> Double {
    let nextValue = defaultWeights[11]
        * Foundation.pow(difficulty, -defaultWeights[12])
        * (Foundation.pow(stability + 1, defaultWeights[13]) - 1)
        * Foundation.exp((1 - retrievability) * defaultWeights[14])

    return roundTo8(value: clamp(value: nextValue, min: fsrsMinimumStability, max: 36_500))
}

private struct ShortTermWeights: Hashable {
    let w17: Double
    let w18: Double
}

// Keep in sync with apps/backend/src/schedule.ts::getShortTermWeights(settings:).
private func getShortTermWeights(settings: WorkspaceSchedulerSettings) -> ShortTermWeights {
    if settings.relearningStepsMinutes.count <= 1 {
        return ShortTermWeights(
            w17: defaultWeights[17],
            w18: defaultWeights[18]
        )
    }

    let value = -(
        Foundation.log(defaultWeights[11])
        + Foundation.log(Foundation.pow(2, defaultWeights[13]) - 1)
        + defaultWeights[14] * 0.3
    ) / Double(settings.relearningStepsMinutes.count)
    let ceiling = clamp(
        value: roundTo8(value: value),
        min: 0.01,
        max: W17_W18_CEILING
    )

    return ShortTermWeights(
        w17: clamp(value: defaultWeights[17], min: 0, max: ceiling),
        w18: clamp(value: defaultWeights[18], min: 0, max: ceiling)
    )
}

// Keep in sync with apps/backend/src/schedule.ts::nextShortTermStability.
private func nextShortTermStability(
    stability: Double,
    grade: Int,
    settings: WorkspaceSchedulerSettings
) -> Double {
    let shortTermWeights = getShortTermWeights(settings: settings)
    let sinc = Foundation.pow(stability, -defaultWeights[19])
        * Foundation.exp(shortTermWeights.w17 * (Double(grade - 3) + shortTermWeights.w18))
    let maskedSinc = grade >= 3 ? max(sinc, 1) : sinc
    return roundTo8(value: clamp(value: stability * maskedSinc, min: fsrsMinimumStability, max: 36_500))
}

// State-specific memory updates follow ts-fsrs:
// new -> initial memory, learning/relearning -> short-term update, review -> review formulas.
// Keep in sync with apps/backend/src/schedule.ts::createInitialMemoryState.
private func createInitialMemoryState(grade: Int) -> FsrsMemoryState {
    return FsrsMemoryState(
        difficulty: clamp(value: initDifficulty(grade: grade), min: 1, max: 10),
        stability: initStability(grade: grade)
    )
}

// Keep in sync with apps/backend/src/schedule.ts::computeNextShortTermMemoryState.
private func computeNextShortTermMemoryState(
    memoryState: FsrsMemoryState,
    grade: Int,
    settings: WorkspaceSchedulerSettings
) -> FsrsMemoryState {
    FsrsMemoryState(
        difficulty: nextDifficulty(difficulty: memoryState.difficulty, grade: grade),
        stability: nextShortTermStability(
            stability: memoryState.stability,
            grade: grade,
            settings: settings
        )
    )
}

// Keep in sync with apps/backend/src/schedule.ts::computeNextReviewMemoryState.
private func computeNextReviewMemoryState(
    memoryState: FsrsMemoryState,
    elapsedDays: Int,
    grade: Int,
    settings: WorkspaceSchedulerSettings
) -> FsrsMemoryState {
    let retrievability = forgettingCurve(elapsedDays: elapsedDays, stability: memoryState.stability)
    let stabilityAfterSuccess = nextRecallStability(
        difficulty: memoryState.difficulty,
        stability: memoryState.stability,
        retrievability: retrievability,
        grade: grade
    )
    let stabilityAfterFailure = nextForgetStability(
        difficulty: memoryState.difficulty,
        stability: memoryState.stability,
        retrievability: retrievability
    )

    var nextStability = stabilityAfterSuccess
    if grade == 1 {
        let shortTermWeights = getShortTermWeights(settings: settings)
        let nextStabilityMin = memoryState.stability / Foundation.exp(shortTermWeights.w17 * shortTermWeights.w18)
        nextStability = clamp(
            value: roundTo8(value: nextStabilityMin),
            min: fsrsMinimumStability,
            max: stabilityAfterFailure
        )
    }

    return FsrsMemoryState(
        difficulty: nextDifficulty(difficulty: memoryState.difficulty, grade: grade),
        stability: nextStability
    )
}

// Keep in sync with apps/backend/src/schedule.ts::getFuzzRange.
private func getFuzzRange(
    interval: Int,
    elapsedDays: Int,
    maximumInterval: Int
) -> FuzzRange {
    var delta = 1.0
    for range in fuzzRanges {
        delta += range.factor * max(min(Double(interval), range.end) - range.start, 0)
    }

    let clampedInterval = min(interval, maximumInterval)
    var minInterval = max(2, Int((Double(clampedInterval) - delta).rounded()))
    let maxInterval = min(Int((Double(clampedInterval) + delta).rounded()), maximumInterval)

    if clampedInterval > elapsedDays {
        minInterval = max(minInterval, elapsedDays + 1)
    }

    minInterval = min(minInterval, maxInterval)
    return FuzzRange(minInterval: minInterval, maxInterval: maxInterval)
}

// Keep in sync with apps/backend/src/schedule.ts::getIntervalSeed.
private func getIntervalSeed(
    now: Date,
    reps: Int,
    memoryState: FsrsMemoryState?
) -> String {
    let memoryProduct = memoryState.map { state in
        state.difficulty * state.stability
    } ?? 0
    let reviewTimeMilliseconds = Int64((now.timeIntervalSince1970 * 1_000).rounded())
    return "\(reviewTimeMilliseconds)_\(reps)_\(formatSeedNumber(value: memoryProduct))"
}

// Keep in sync with apps/backend/src/schedule.ts::nextInterval.
private func nextInterval(
    stability: Double,
    elapsedDays: Int,
    settings: WorkspaceSchedulerSettings,
    intervalSeed: String
) -> Int {
    let intervalModifier = getIntervalModifier(requestRetention: settings.desiredRetention)
    let nextRawInterval = Int(
        clamp(
            value: Double((stability * intervalModifier).rounded()),
            min: 1,
            max: Double(settings.maximumIntervalDays)
        )
    )

    if settings.enableFuzz == false || nextRawInterval < 3 {
        return nextRawInterval
    }

    var prng = AleaGenerator(seed: intervalSeed)
    let fuzzFactor = prng.next()
    let fuzzRange = getFuzzRange(
        interval: nextRawInterval,
        elapsedDays: elapsedDays,
        maximumInterval: settings.maximumIntervalDays
    )

    return Int(
        Foundation.floor(
            fuzzFactor * Double(fuzzRange.maxInterval - fuzzRange.minInterval + 1)
            + Double(fuzzRange.minInterval)
        )
    )
}

// Keep in sync with apps/backend/src/schedule.ts::getMemoryState.
private func getMemoryState(card: ReviewableCardScheduleState) throws -> FsrsMemoryState? {
    if stateRequiresMemory(state: card.fsrsCardState) == false {
        if card.fsrsStability != nil
            || card.fsrsDifficulty != nil
            || card.fsrsLastReviewedAt != nil
            || card.fsrsScheduledDays != nil
            || card.fsrsStepIndex != nil {
            throw LocalStoreError.database("New card must not have persisted FSRS state")
        }

        return nil
    }

    guard
        let stability = card.fsrsStability,
        let difficulty = card.fsrsDifficulty,
        let _ = card.fsrsLastReviewedAt,
        let _ = card.fsrsScheduledDays
    else {
        throw LocalStoreError.database("Persisted FSRS card state is incomplete")
    }

    if card.fsrsCardState == .review && card.fsrsStepIndex != nil {
        throw LocalStoreError.database("Review card must not persist fsrsStepIndex")
    }

    if (card.fsrsCardState == .learning || card.fsrsCardState == .relearning) && card.fsrsStepIndex == nil {
        throw LocalStoreError.database("Learning or relearning card is missing fsrsStepIndex")
    }

    return FsrsMemoryState(
        difficulty: difficulty,
        stability: stability
    )
}

// Keep in sync with apps/backend/src/schedule.ts::buildGraduatedReviewSchedule.
private func buildGraduatedReviewSchedule(
    nextMemoryState: FsrsMemoryState,
    now: Date,
    reps: Int,
    lapses: Int,
    settings: WorkspaceSchedulerSettings,
    elapsedDays: Int,
    intervalSeed: String
) -> ReviewSchedule {
    let scheduledDays = nextInterval(
        stability: nextMemoryState.stability,
        elapsedDays: elapsedDays,
        settings: settings,
        intervalSeed: intervalSeed
    )

    return ReviewSchedule(
        dueAt: dateByAddingDays(date: now, days: scheduledDays),
        reps: reps,
        lapses: lapses,
        fsrsCardState: .review,
        fsrsStepIndex: nil,
        fsrsStability: nextMemoryState.stability,
        fsrsDifficulty: nextMemoryState.difficulty,
        fsrsLastReviewedAt: now,
        fsrsScheduledDays: scheduledDays
    )
}

// Keep in sync with apps/backend/src/schedule.ts::buildShortTermSchedule.
private func buildShortTermSchedule(
    card: ReviewableCardScheduleState,
    nextMemoryState: FsrsMemoryState,
    rating: ReviewRating,
    now: Date,
    reps: Int,
    lapses: Int,
    settings: WorkspaceSchedulerSettings,
    nextState: FsrsCardState,
    elapsedDays: Int,
    intervalSeed: String
) throws -> ReviewSchedule {
    let grade = mapRatingToFsrsGrade(rating: rating)
    let learningStep = try getLearningStepResult(
        settings: settings,
        card: card,
        grade: grade
    )

    if learningStep.scheduledMinutes == nil {
        return buildGraduatedReviewSchedule(
            nextMemoryState: nextMemoryState,
            now: now,
            reps: reps,
            lapses: lapses,
            settings: settings,
            elapsedDays: elapsedDays,
            intervalSeed: intervalSeed
        )
    }

    return ReviewSchedule(
        dueAt: dateByAddingMinutes(date: now, minutes: learningStep.scheduledMinutes ?? 0),
        reps: reps,
        lapses: lapses,
        fsrsCardState: nextState,
        fsrsStepIndex: learningStep.nextStepIndex,
        fsrsStability: nextMemoryState.stability,
        fsrsDifficulty: nextMemoryState.difficulty,
        fsrsLastReviewedAt: now,
        fsrsScheduledDays: 0
    )
}

// Keep in sync with apps/backend/src/schedule.ts::buildReviewSuccessSchedule.
private func buildReviewSuccessSchedule(
    now: Date,
    reps: Int,
    lapses: Int,
    settings: WorkspaceSchedulerSettings,
    elapsedDays: Int,
    hardMemoryState: FsrsMemoryState,
    goodMemoryState: FsrsMemoryState,
    easyMemoryState: FsrsMemoryState,
    rating: ReviewRating,
    intervalSeed: String
) -> ReviewSchedule {
    var hardInterval = nextInterval(
        stability: hardMemoryState.stability,
        elapsedDays: elapsedDays,
        settings: settings,
        intervalSeed: intervalSeed
    )
    var goodInterval = nextInterval(
        stability: goodMemoryState.stability,
        elapsedDays: elapsedDays,
        settings: settings,
        intervalSeed: intervalSeed
    )

    hardInterval = min(hardInterval, goodInterval)
    goodInterval = max(goodInterval, hardInterval + 1)
    let easyInterval = max(
        nextInterval(
            stability: easyMemoryState.stability,
            elapsedDays: elapsedDays,
            settings: settings,
            intervalSeed: intervalSeed
        ),
        goodInterval + 1
    )

    if rating == .hard {
        return ReviewSchedule(
            dueAt: dateByAddingDays(date: now, days: hardInterval),
            reps: reps,
            lapses: lapses,
            fsrsCardState: .review,
            fsrsStepIndex: nil,
            fsrsStability: hardMemoryState.stability,
            fsrsDifficulty: hardMemoryState.difficulty,
            fsrsLastReviewedAt: now,
            fsrsScheduledDays: hardInterval
        )
    }

    if rating == .good {
        return ReviewSchedule(
            dueAt: dateByAddingDays(date: now, days: goodInterval),
            reps: reps,
            lapses: lapses,
            fsrsCardState: .review,
            fsrsStepIndex: nil,
            fsrsStability: goodMemoryState.stability,
            fsrsDifficulty: goodMemoryState.difficulty,
            fsrsLastReviewedAt: now,
            fsrsScheduledDays: goodInterval
        )
    }

    return ReviewSchedule(
        dueAt: dateByAddingDays(date: now, days: easyInterval),
        reps: reps,
        lapses: lapses,
        fsrsCardState: .review,
        fsrsStepIndex: nil,
        fsrsStability: easyMemoryState.stability,
        fsrsDifficulty: easyMemoryState.difficulty,
        fsrsLastReviewedAt: now,
        fsrsScheduledDays: easyInterval
    )
}

// Keep in sync with apps/backend/src/schedule.ts::createEmptyReviewableCardScheduleState.
func createEmptyReviewableCardScheduleState(cardId: String) -> ReviewableCardScheduleState {
    ReviewableCardScheduleState(
        cardId: cardId,
        reps: 0,
        lapses: 0,
        fsrsCardState: .new,
        fsrsStepIndex: nil,
        fsrsStability: nil,
        fsrsDifficulty: nil,
        fsrsLastReviewedAt: nil,
        fsrsScheduledDays: nil
    )
}

// Keep in sync with apps/backend/src/cards.ts::toReviewableCardScheduleState and apps/backend/src/schedule.ts::ReviewableCardScheduleState.
private func makeReviewableCardScheduleState(card: Card) -> ReviewableCardScheduleState {
    ReviewableCardScheduleState(
        cardId: card.cardId,
        reps: card.reps,
        lapses: card.lapses,
        fsrsCardState: card.fsrsCardState,
        fsrsStepIndex: card.fsrsStepIndex,
        fsrsStability: card.fsrsStability,
        fsrsDifficulty: card.fsrsDifficulty,
        fsrsLastReviewedAt: card.fsrsLastReviewedAt.flatMap(parseIsoTimestamp),
        fsrsScheduledDays: card.fsrsScheduledDays
    )
}

// Keep in sync with apps/backend/src/cards.ts::submitReview and apps/backend/src/schedule.ts::computeReviewSchedule.
func computeReviewSchedule(
    card: Card,
    settings: WorkspaceSchedulerSettings,
    rating: ReviewRating,
    now: Date
) throws -> ReviewSchedule {
    try computeReviewSchedule(
        card: makeReviewableCardScheduleState(card: card),
        settings: settings,
        rating: rating,
        now: now
    )
}

// Keep in sync with apps/backend/src/schedule.ts::computeReviewSchedule.
func computeReviewSchedule(
    card: ReviewableCardScheduleState,
    settings: WorkspaceSchedulerSettings,
    rating: ReviewRating,
    now: Date
) throws -> ReviewSchedule {
    let memoryState = try getMemoryState(card: card)
    let grade = mapRatingToFsrsGrade(rating: rating)
    let elapsedDays = try card.fsrsLastReviewedAt.map { lastReviewedAt in
        try dateDiffInDays(lastReviewedAt: lastReviewedAt, now: now)
    } ?? 0
    let reps = card.reps + 1
    let lapses = rating == .again && card.fsrsCardState == .review ? card.lapses + 1 : card.lapses
    let intervalSeed = getIntervalSeed(
        now: now,
        reps: reps,
        memoryState: memoryState
    )

    if card.fsrsCardState == .new {
        let nextMemoryState = createInitialMemoryState(grade: grade)

        return try buildShortTermSchedule(
            card: card,
            nextMemoryState: nextMemoryState,
            rating: rating,
            now: now,
            reps: reps,
            lapses: lapses,
            settings: settings,
            nextState: .learning,
            elapsedDays: 0,
            intervalSeed: intervalSeed
        )
    }

    guard let memoryState else {
        throw LocalStoreError.database("Persisted FSRS card state is incomplete")
    }

    if card.fsrsCardState == .learning || card.fsrsCardState == .relearning {
        let nextMemoryState = computeNextShortTermMemoryState(
            memoryState: memoryState,
            grade: grade,
            settings: settings
        )

        return try buildShortTermSchedule(
            card: card,
            nextMemoryState: nextMemoryState,
            rating: rating,
            now: now,
            reps: reps,
            lapses: lapses,
            settings: settings,
            nextState: card.fsrsCardState,
            elapsedDays: elapsedDays,
            intervalSeed: intervalSeed
        )
    }

    let nextAgainMemoryState = computeNextReviewMemoryState(
        memoryState: memoryState,
        elapsedDays: elapsedDays,
        grade: 1,
        settings: settings
    )
    let nextHardMemoryState = computeNextReviewMemoryState(
        memoryState: memoryState,
        elapsedDays: elapsedDays,
        grade: 2,
        settings: settings
    )
    let nextGoodMemoryState = computeNextReviewMemoryState(
        memoryState: memoryState,
        elapsedDays: elapsedDays,
        grade: 3,
        settings: settings
    )
    let nextEasyMemoryState = computeNextReviewMemoryState(
        memoryState: memoryState,
        elapsedDays: elapsedDays,
        grade: 4,
        settings: settings
    )

    if rating == .again {
        return try buildShortTermSchedule(
            card: card,
            nextMemoryState: nextAgainMemoryState,
            rating: rating,
            now: now,
            reps: reps,
            lapses: lapses,
            settings: settings,
            nextState: .relearning,
            elapsedDays: elapsedDays,
            intervalSeed: intervalSeed
        )
    }

    return buildReviewSuccessSchedule(
        now: now,
        reps: reps,
        lapses: lapses,
        settings: settings,
        elapsedDays: elapsedDays,
        hardMemoryState: nextHardMemoryState,
        goodMemoryState: nextGoodMemoryState,
        easyMemoryState: nextEasyMemoryState,
        rating: rating,
        intervalSeed: intervalSeed
    )
}

// Keep in sync with apps/backend/src/schedule.ts::rebuildCardScheduleState.
func rebuildCardScheduleState(
    cardId: String,
    settings: WorkspaceSchedulerSettings,
    reviewEvents: [FsrsReviewHistoryEvent]
) throws -> RebuiltCardScheduleState {
    if reviewEvents.isEmpty {
        return RebuiltCardScheduleState(
            dueAt: nil,
            reps: 0,
            lapses: 0,
            fsrsCardState: .new,
            fsrsStepIndex: nil,
            fsrsStability: nil,
            fsrsDifficulty: nil,
            fsrsLastReviewedAt: nil,
            fsrsScheduledDays: nil
        )
    }

    var state = createEmptyReviewableCardScheduleState(cardId: cardId)
    var dueAt: Date?

    for reviewEvent in reviewEvents {
        let nextState = try computeReviewSchedule(
            card: state,
            settings: settings,
            rating: reviewEvent.rating,
            now: reviewEvent.reviewedAt
        )

        state = ReviewableCardScheduleState(
            cardId: state.cardId,
            reps: nextState.reps,
            lapses: nextState.lapses,
            fsrsCardState: nextState.fsrsCardState,
            fsrsStepIndex: nextState.fsrsStepIndex,
            fsrsStability: nextState.fsrsStability,
            fsrsDifficulty: nextState.fsrsDifficulty,
            fsrsLastReviewedAt: nextState.fsrsLastReviewedAt,
            fsrsScheduledDays: nextState.fsrsScheduledDays
        )
        dueAt = nextState.dueAt
    }

    return RebuiltCardScheduleState(
        dueAt: dueAt,
        reps: state.reps,
        lapses: state.lapses,
        fsrsCardState: state.fsrsCardState,
        fsrsStepIndex: state.fsrsStepIndex,
        fsrsStability: state.fsrsStability,
        fsrsDifficulty: state.fsrsDifficulty,
        fsrsLastReviewedAt: state.fsrsLastReviewedAt,
        fsrsScheduledDays: state.fsrsScheduledDays
    )
}
