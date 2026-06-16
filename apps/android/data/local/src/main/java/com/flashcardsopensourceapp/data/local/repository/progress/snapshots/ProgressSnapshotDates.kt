package com.flashcardsopensourceapp.data.local.repository.progress.snapshots

import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakDay
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakDayState
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakFreeze
import java.time.LocalDate
import java.time.format.DateTimeParseException

private val progressStreakFreezePolicy = ProgressStreakFreezePolicy(
    startCapacity = 2,
    maxCapacity = 2,
    unitsPerCredit = 10,
    earnedUnitsPerStreakDay = 1
)

internal data class ProgressStreakFreezeEvaluation(
    val currentStreakDays: Int,
    val longestStreakDays: Int,
    val streakFreeze: CloudProgressStreakFreeze,
    val streakDays: List<CloudProgressStreakDay>
)

private data class ProgressStreakFreezePolicy(
    val startCapacity: Int,
    val maxCapacity: Int,
    val unitsPerCredit: Int,
    val earnedUnitsPerStreakDay: Int
)

private data class ProgressStreakComputationState(
    val balanceUnits: Int,
    val currentStreakDays: Int,
    val longestStreakDays: Int,
    val hasActiveSegment: Boolean,
    val lastEvaluatedDate: LocalDate?
)

internal fun parseLocalDate(
    rawDate: String
): LocalDate {
    return try {
        LocalDate.parse(rawDate)
    } catch (error: DateTimeParseException) {
        throw IllegalArgumentException("Invalid local date '$rawDate'.", error)
    }
}

internal fun createInclusiveLocalDateRange(
    from: String,
    to: String
): List<String> {
    val startDate = parseLocalDate(rawDate = from)
    val endDate = parseLocalDate(rawDate = to)
    val dates = mutableListOf<String>()
    var currentDate = startDate

    while (currentDate <= endDate) {
        dates.add(currentDate.toString())
        currentDate = currentDate.plusDays(1L)
    }

    return dates
}

internal fun evaluateProgressStreakFreeze(
    sortedActiveReviewLocalDates: List<String>,
    today: LocalDate
): ProgressStreakFreezeEvaluation {
    validateProgressStreakFreezePolicy(policy = progressStreakFreezePolicy)
    validateSortedActiveReviewLocalDates(sortedActiveReviewLocalDates = sortedActiveReviewLocalDates)

    val statesByDate = linkedMapOf<String, CloudProgressStreakDayState>()
    val finalState = sortedActiveReviewLocalDates
        .filter { localDate -> localDate <= today.toString() }
        .map { localDate -> parseLocalDate(rawDate = localDate) }
        .fold(createInitialStreakState(policy = progressStreakFreezePolicy)) { state, reviewDate ->
            addReviewedStreakDay(
                state = addNonReviewedStreakDaysBeforeReview(
                    state = state,
                    nextReviewDate = reviewDate,
                    policy = progressStreakFreezePolicy,
                    statesByDate = statesByDate
                ),
                date = reviewDate,
                policy = progressStreakFreezePolicy,
                statesByDate = statesByDate
            )
        }.let { stateAfterReviews ->
            addTrailingStreakDaysThroughToday(
                state = stateAfterReviews,
                today = today,
                policy = progressStreakFreezePolicy,
                statesByDate = statesByDate
            )
        }

    return ProgressStreakFreezeEvaluation(
        currentStreakDays = finalState.currentStreakDays,
        longestStreakDays = finalState.longestStreakDays,
        streakFreeze = createProgressStreakFreeze(
            balanceUnits = finalState.balanceUnits,
            policy = progressStreakFreezePolicy
        ),
        streakDays = createProgressStreakDays(statesByDate = statesByDate)
    )
}

internal fun createProgressStreakDaysForRange(
    activeReviewDateSet: Set<String>,
    from: String,
    to: String,
    today: LocalDate
): List<CloudProgressStreakDay> {
    val evaluation = evaluateProgressStreakFreeze(
        sortedActiveReviewLocalDates = activeReviewDateSet.sorted(),
        today = today
    )
    val evaluatedStatesByDate = evaluation.streakDays.associate { day ->
        day.date to day.state
    }

    return createInclusiveLocalDateRange(
        from = from,
        to = to
    ).map { date ->
        val state = when {
            activeReviewDateSet.contains(date) -> CloudProgressStreakDayState.REVIEWED
            evaluatedStatesByDate[date] != null -> checkNotNull(evaluatedStatesByDate[date])
            date >= today.toString() -> CloudProgressStreakDayState.PENDING
            else -> CloudProgressStreakDayState.MISSED
        }
        CloudProgressStreakDay(
            date = date,
            state = state
        )
    }
}

internal fun createInitialProgressStreakFreeze(): CloudProgressStreakFreeze {
    return createProgressStreakFreeze(
        balanceUnits = getInitialBalanceUnits(policy = progressStreakFreezePolicy),
        policy = progressStreakFreezePolicy
    )
}

private fun validateProgressStreakFreezePolicy(
    policy: ProgressStreakFreezePolicy
) {
    if (policy.startCapacity < 0) {
        throw IllegalArgumentException("streak freeze startCapacity must be a non-negative integer.")
    }
    if (policy.maxCapacity < 0) {
        throw IllegalArgumentException("streak freeze maxCapacity must be a non-negative integer.")
    }
    if (policy.unitsPerCredit <= 0) {
        throw IllegalArgumentException("streak freeze unitsPerCredit must be a positive integer.")
    }
    if (policy.earnedUnitsPerStreakDay < 0) {
        throw IllegalArgumentException("streak freeze earnedUnitsPerStreakDay must be a non-negative integer.")
    }
}

private fun validateSortedActiveReviewLocalDates(
    sortedActiveReviewLocalDates: List<String>
) {
    var previousDate: String? = null
    sortedActiveReviewLocalDates.forEach { localDate ->
        parseLocalDate(rawDate = localDate)
        val previous = previousDate
        if (previous != null && previous >= localDate) {
            throw IllegalArgumentException("Active review local dates must be sorted ascending without duplicates.")
        }
        previousDate = localDate
    }
}

private fun createInitialStreakState(
    policy: ProgressStreakFreezePolicy
): ProgressStreakComputationState {
    return ProgressStreakComputationState(
        balanceUnits = getInitialBalanceUnits(policy = policy),
        currentStreakDays = 0,
        longestStreakDays = 0,
        hasActiveSegment = false,
        lastEvaluatedDate = null
    )
}

private fun addReviewedStreakDay(
    state: ProgressStreakComputationState,
    date: LocalDate,
    policy: ProgressStreakFreezePolicy,
    statesByDate: MutableMap<String, CloudProgressStreakDayState>
): ProgressStreakComputationState {
    val balanceUnits = addStreakDayEarnedUnits(
        balanceUnits = if (state.hasActiveSegment) {
            state.balanceUnits
        } else {
            getInitialBalanceUnits(policy = policy)
        },
        policy = policy
    )
    val currentStreakDays = if (state.hasActiveSegment) {
        state.currentStreakDays + 1
    } else {
        1
    }
    statesByDate[date.toString()] = CloudProgressStreakDayState.REVIEWED

    return ProgressStreakComputationState(
        balanceUnits = balanceUnits,
        currentStreakDays = currentStreakDays,
        longestStreakDays = maxOf(state.longestStreakDays, currentStreakDays),
        hasActiveSegment = true,
        lastEvaluatedDate = date
    )
}

private fun addFrozenStreakDay(
    state: ProgressStreakComputationState,
    date: LocalDate,
    policy: ProgressStreakFreezePolicy,
    statesByDate: MutableMap<String, CloudProgressStreakDayState>
): ProgressStreakComputationState {
    val balanceUnitsAfterSpend = state.balanceUnits - policy.unitsPerCredit
    val balanceUnits = addStreakDayEarnedUnits(
        balanceUnits = balanceUnitsAfterSpend,
        policy = policy
    )
    val currentStreakDays = state.currentStreakDays + 1
    statesByDate[date.toString()] = CloudProgressStreakDayState.FROZEN

    return ProgressStreakComputationState(
        balanceUnits = balanceUnits,
        currentStreakDays = currentStreakDays,
        longestStreakDays = maxOf(state.longestStreakDays, currentStreakDays),
        hasActiveSegment = true,
        lastEvaluatedDate = date
    )
}

private fun addMissedStreakDay(
    state: ProgressStreakComputationState,
    date: LocalDate,
    policy: ProgressStreakFreezePolicy,
    statesByDate: MutableMap<String, CloudProgressStreakDayState>
): ProgressStreakComputationState {
    statesByDate[date.toString()] = CloudProgressStreakDayState.MISSED

    return ProgressStreakComputationState(
        balanceUnits = getInitialBalanceUnits(policy = policy),
        currentStreakDays = 0,
        longestStreakDays = state.longestStreakDays,
        hasActiveSegment = false,
        lastEvaluatedDate = date
    )
}

private fun addPendingStreakDay(
    state: ProgressStreakComputationState,
    date: LocalDate,
    statesByDate: MutableMap<String, CloudProgressStreakDayState>
): ProgressStreakComputationState {
    statesByDate[date.toString()] = CloudProgressStreakDayState.PENDING

    return state.copy(lastEvaluatedDate = date)
}

private fun addNonReviewedCompletedStreakDay(
    state: ProgressStreakComputationState,
    date: LocalDate,
    policy: ProgressStreakFreezePolicy,
    statesByDate: MutableMap<String, CloudProgressStreakDayState>
): ProgressStreakComputationState {
    val hasFreezeCredit = getAvailableCredits(
        balanceUnits = state.balanceUnits,
        policy = policy
    ) > 0
    return if (state.hasActiveSegment && hasFreezeCredit) {
        addFrozenStreakDay(
            state = state,
            date = date,
            policy = policy,
            statesByDate = statesByDate
        )
    } else {
        addMissedStreakDay(
            state = state,
            date = date,
            policy = policy,
            statesByDate = statesByDate
        )
    }
}

private fun addNonReviewedStreakDaysBeforeReview(
    state: ProgressStreakComputationState,
    nextReviewDate: LocalDate,
    policy: ProgressStreakFreezePolicy,
    statesByDate: MutableMap<String, CloudProgressStreakDayState>
): ProgressStreakComputationState {
    var currentState = state
    var currentDate = currentState.lastEvaluatedDate?.plusDays(1L) ?: nextReviewDate

    while (currentState.lastEvaluatedDate != null && currentDate.isBefore(nextReviewDate)) {
        currentState = addNonReviewedCompletedStreakDay(
            state = currentState,
            date = currentDate,
            policy = policy,
            statesByDate = statesByDate
        )
        currentDate = currentDate.plusDays(1L)
    }

    return currentState
}

private fun addTrailingStreakDaysThroughToday(
    state: ProgressStreakComputationState,
    today: LocalDate,
    policy: ProgressStreakFreezePolicy,
    statesByDate: MutableMap<String, CloudProgressStreakDayState>
): ProgressStreakComputationState {
    var currentState = state
    var currentDate = currentState.lastEvaluatedDate?.plusDays(1L) ?: today

    while (currentDate <= today) {
        currentState = if (currentDate == today) {
            addPendingStreakDay(
                state = currentState,
                date = currentDate,
                statesByDate = statesByDate
            )
        } else {
            addNonReviewedCompletedStreakDay(
                state = currentState,
                date = currentDate,
                policy = policy,
                statesByDate = statesByDate
            )
        }
        currentDate = currentDate.plusDays(1L)
    }

    return currentState
}

private fun createProgressStreakFreeze(
    balanceUnits: Int,
    policy: ProgressStreakFreezePolicy
): CloudProgressStreakFreeze {
    val clampedBalanceUnits = clampBalanceUnits(
        balanceUnits = balanceUnits,
        policy = policy
    )
    val availableCredits = getAvailableCredits(
        balanceUnits = clampedBalanceUnits,
        policy = policy
    )

    return CloudProgressStreakFreeze(
        availableCredits = availableCredits,
        capacity = policy.maxCapacity,
        balanceUnits = clampedBalanceUnits,
        unitsPerCredit = policy.unitsPerCredit,
        earnedUnitsPerStreakDay = policy.earnedUnitsPerStreakDay,
        nextCreditProgressUnits = if (availableCredits >= policy.maxCapacity) {
            0
        } else {
            clampedBalanceUnits % policy.unitsPerCredit
        },
        nextCreditRequiredUnits = policy.unitsPerCredit
    )
}

private fun createProgressStreakDays(
    statesByDate: Map<String, CloudProgressStreakDayState>
): List<CloudProgressStreakDay> {
    return statesByDate.entries.sortedBy { entry ->
        entry.key
    }.map { entry ->
        CloudProgressStreakDay(
            date = entry.key,
            state = entry.value
        )
    }
}

private fun getInitialBalanceUnits(
    policy: ProgressStreakFreezePolicy
): Int {
    return minOf(policy.startCapacity, policy.maxCapacity) * policy.unitsPerCredit
}

private fun getAvailableCredits(
    balanceUnits: Int,
    policy: ProgressStreakFreezePolicy
): Int {
    return minOf(policy.maxCapacity, balanceUnits / policy.unitsPerCredit)
}

private fun addStreakDayEarnedUnits(
    balanceUnits: Int,
    policy: ProgressStreakFreezePolicy
): Int {
    return clampBalanceUnits(
        balanceUnits = balanceUnits + policy.earnedUnitsPerStreakDay,
        policy = policy
    )
}

private fun clampBalanceUnits(
    balanceUnits: Int,
    policy: ProgressStreakFreezePolicy
): Int {
    return minOf(balanceUnits, policy.maxCapacity * policy.unitsPerCredit)
}
