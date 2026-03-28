package com.flashcardsopensourceapp.data.local.model

private const val defaultDesiredRetention: Double = 0.90
private const val defaultMaximumIntervalDays: Int = 36_500

private fun validateSchedulerStepList(values: List<Int>, fieldName: String): List<Int> {
    require(values.isNotEmpty()) {
        "$fieldName must not be empty."
    }
    require(values.all { value -> value > 0 && value < 1_440 }) {
        "$fieldName must contain positive integer minutes under 1440."
    }

    for (index in 1 until values.size) {
        require(values[index] > values[index - 1]) {
            "$fieldName must be strictly increasing."
        }
    }

    return values
}

fun makeDefaultWorkspaceSchedulerSettings(
    workspaceId: String,
    updatedAtMillis: Long
): WorkspaceSchedulerSettings {
    return WorkspaceSchedulerSettings(
        workspaceId = workspaceId,
        algorithm = "fsrs-6",
        desiredRetention = defaultDesiredRetention,
        learningStepsMinutes = listOf(1, 10),
        relearningStepsMinutes = listOf(10),
        maximumIntervalDays = defaultMaximumIntervalDays,
        enableFuzz = true,
        updatedAtMillis = updatedAtMillis
    )
}

fun validateWorkspaceSchedulerSettingsInput(
    workspaceId: String,
    desiredRetention: Double,
    learningStepsMinutes: List<Int>,
    relearningStepsMinutes: List<Int>,
    maximumIntervalDays: Int,
    enableFuzz: Boolean,
    updatedAtMillis: Long
): WorkspaceSchedulerSettings {
    require(desiredRetention > 0 && desiredRetention < 1) {
        "Desired retention must be greater than 0 and less than 1."
    }
    require(maximumIntervalDays > 0) {
        "Maximum interval must be a positive integer."
    }

    return WorkspaceSchedulerSettings(
        workspaceId = workspaceId,
        algorithm = "fsrs-6",
        desiredRetention = desiredRetention,
        learningStepsMinutes = validateSchedulerStepList(
            values = learningStepsMinutes,
            fieldName = "Learning steps"
        ),
        relearningStepsMinutes = validateSchedulerStepList(
            values = relearningStepsMinutes,
            fieldName = "Relearning steps"
        ),
        maximumIntervalDays = maximumIntervalDays,
        enableFuzz = enableFuzz,
        updatedAtMillis = updatedAtMillis
    )
}

fun encodeSchedulerStepListJson(values: List<Int>): String {
    return "[" + values.joinToString(separator = ",") + "]"
}

fun decodeSchedulerStepListJson(json: String): List<Int> {
    val trimmed = json.trim()
    require(trimmed.startsWith("[") && trimmed.endsWith("]")) {
        "Scheduler steps JSON must be an array."
    }

    val body = trimmed.removePrefix("[").removeSuffix("]").trim()
    if (body.isEmpty()) {
        return emptyList()
    }

    return body.split(",").map { value ->
        value.trim().toInt()
    }
}
