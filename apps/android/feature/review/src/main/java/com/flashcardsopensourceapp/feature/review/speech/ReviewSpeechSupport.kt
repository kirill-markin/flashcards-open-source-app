package com.flashcardsopensourceapp.feature.review

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.flashcardsopensourceapp.core.observability.AndroidReviewSpeechFailureStage
import com.flashcardsopensourceapp.core.observability.AndroidWarningIssueEvent
import com.flashcardsopensourceapp.core.observability.AppObservability
import java.util.Locale
import java.util.UUID

enum class ReviewSpeechSide {
    FRONT,
    BACK
}

private enum class ReviewSpeechInitState {
    NOT_INITIALIZED,
    PENDING,
    READY,
    FAILED
}

private data class PendingReviewSpeechRequest(
    val side: ReviewSpeechSide,
    val speakableText: String,
    val fallbackLanguageTag: String,
    val onError: (String) -> Unit
)

private data class ActiveReviewSpeechUtterance(
    val utteranceId: String,
    val languageTag: String,
    val languageStatus: Int,
    val voiceName: String?,
    val onError: (String) -> Unit
)

private sealed interface ReviewSpeechLanguageResult {
    val languageStatus: Int
    val voiceName: String?

    data class Applied(
        override val languageStatus: Int,
        override val voiceName: String?
    ) : ReviewSpeechLanguageResult

    data class Failed(
        val stage: AndroidReviewSpeechFailureStage,
        val errorCode: Int?,
        override val languageStatus: Int,
        override val voiceName: String?
    ) : ReviewSpeechLanguageResult
}

private data class ReviewSpeechLanguageHeuristic(
    val languageTag: String,
    val markers: List<String>
)

private val reviewSpeechLatinLanguageHeuristics = listOf(
    ReviewSpeechLanguageHeuristic(
        languageTag = "es-ES",
        markers = listOf(" el ", " la ", " que ", " de ", " y ", " por ", " para ", " hola ", " gracias ", " cómo ")
    ),
    ReviewSpeechLanguageHeuristic(
        languageTag = "fr-FR",
        markers = listOf(" le ", " la ", " les ", " des ", " une ", " bonjour ", " merci ", " avec ", " pour ", " est ")
    ),
    ReviewSpeechLanguageHeuristic(
        languageTag = "de-DE",
        markers = listOf(" der ", " die ", " das ", " und ", " nicht ", " danke ", " bitte ", " ist ", " wie ", " ich ")
    ),
    ReviewSpeechLanguageHeuristic(
        languageTag = "it-IT",
        markers = listOf(" il ", " lo ", " gli ", " una ", " ciao ", " grazie ", " per ", " non ", " come ", " che ")
    ),
    ReviewSpeechLanguageHeuristic(
        languageTag = "pt-PT",
        markers = listOf(" não ", " você ", " obrigado ", " olá ", " para ", " com ", " uma ", " que ", " está ")
    ),
    ReviewSpeechLanguageHeuristic(
        languageTag = "en-US",
        markers = listOf(" the ", " and ", " you ", " are ", " with ", " this ", " that ", " hello ", " thanks ", " what ")
    )
)

class ReviewSpeechController(
    context: Context,
    private val unavailableMessage: String,
    private val observability: AppObservability
) {
    private val applicationContext = context.applicationContext
    private val mainHandler = Handler(Looper.getMainLooper())

    private var textToSpeech: TextToSpeech? = null
    private var initState: ReviewSpeechInitState = ReviewSpeechInitState.NOT_INITIALIZED
    private var pendingRequest: PendingReviewSpeechRequest? = null
    private var activeUtterance: ActiveReviewSpeechUtterance? = null
    private var isReleased: Boolean = false

    var activeSide: ReviewSpeechSide? by mutableStateOf(value = null)
        private set

    fun toggleSpeech(
        side: ReviewSpeechSide,
        speakableText: String,
        fallbackLanguageTag: String,
        onError: (String) -> Unit
    ) {
        if (speakableText.isEmpty()) {
            return
        }

        if (activeSide == side || pendingRequest?.side == side) {
            stop()
            return
        }

        val request = PendingReviewSpeechRequest(
            side = side,
            speakableText = speakableText,
            fallbackLanguageTag = fallbackLanguageTag,
            onError = onError
        )

        when (initState) {
            ReviewSpeechInitState.NOT_INITIALIZED -> {
                pendingRequest = request
                initializeTextToSpeech()
            }

            ReviewSpeechInitState.PENDING -> {
                pendingRequest = request
            }

            ReviewSpeechInitState.FAILED -> {
                onError(unavailableMessage)
            }

            ReviewSpeechInitState.READY -> {
                speak(request = request)
            }
        }
    }

    fun stop() {
        pendingRequest = null
        activeUtterance = null
        activeSide = null
        textToSpeech?.stop()
    }

    fun release() {
        isReleased = true
        stop()
        textToSpeech?.shutdown()
        textToSpeech = null
        initState = ReviewSpeechInitState.FAILED
    }

    private fun initializeTextToSpeech() {
        if (isReleased || initState != ReviewSpeechInitState.NOT_INITIALIZED) {
            return
        }

        initState = ReviewSpeechInitState.PENDING
        val controller = TextToSpeech(applicationContext) { status ->
            handleInitialization(status = status)
        }
        textToSpeech = controller
        controller.setOnUtteranceProgressListener(
            object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String) = Unit

                override fun onDone(utteranceId: String) {
                    clearActiveUtterance(utteranceId = utteranceId)
                }

                @Deprecated("Required for legacy TextToSpeech callback compatibility.")
                override fun onError(utteranceId: String) {
                    failActiveUtterance(utteranceId = utteranceId, errorCode = null)
                }

                override fun onError(utteranceId: String, errorCode: Int) {
                    failActiveUtterance(utteranceId = utteranceId, errorCode = errorCode)
                }

                override fun onStop(utteranceId: String, interrupted: Boolean) {
                    clearActiveUtterance(utteranceId = utteranceId)
                }
            }
        )
    }

    private fun clearActiveUtterance(utteranceId: String) {
        mainHandler.post {
            if (activeUtterance?.utteranceId == utteranceId) {
                activeUtterance = null
                activeSide = null
            }
        }
    }

    // The engine accepts speak() and reports failures such as a not-installed voice only here.
    private fun failActiveUtterance(utteranceId: String, errorCode: Int?) {
        mainHandler.post {
            val utterance = activeUtterance
            if (utterance == null || utterance.utteranceId != utteranceId) {
                return@post
            }

            activeUtterance = null
            activeSide = null
            captureFailure(
                stage = AndroidReviewSpeechFailureStage.UTTERANCE_ERROR,
                errorCode = errorCode,
                languageStatus = utterance.languageStatus,
                languageTag = utterance.languageTag,
                voiceName = utterance.voiceName
            )
            utterance.onError(unavailableMessage)
        }
    }

    private fun captureFailure(
        stage: AndroidReviewSpeechFailureStage,
        errorCode: Int?,
        languageStatus: Int?,
        languageTag: String,
        voiceName: String?
    ) {
        observability.captureWarning(
            event = AndroidWarningIssueEvent.ReviewSpeechFailure(
                stage = stage,
                errorCode = errorCode,
                languageStatus = languageStatus,
                enginePackage = textToSpeech?.defaultEngine,
                languageTag = languageTag,
                voiceName = voiceName
            )
        )
    }

    private fun handleInitialization(status: Int) {
        if (isReleased) {
            textToSpeech?.shutdown()
            textToSpeech = null
            return
        }

        if (status == TextToSpeech.SUCCESS) {
            initState = ReviewSpeechInitState.READY
            val request = pendingRequest
            pendingRequest = null

            if (request != null) {
                speak(request = request)
            }

            return
        }

        initState = ReviewSpeechInitState.FAILED
        val request = pendingRequest
        pendingRequest = null
        request?.onError?.invoke(unavailableMessage)
    }

    private fun speak(request: PendingReviewSpeechRequest) {
        val controller = textToSpeech
        if (controller == null) {
            request.onError(unavailableMessage)
            return
        }

        val locale = localeFromLanguageTag(languageTag = detectReviewSpeechLanguage(
            text = request.speakableText,
            fallbackLanguageTag = request.fallbackLanguageTag
        ))
        val languageTag = locale.toLanguageTag()
        val languageResult = applyReviewSpeechLanguage(controller = controller, locale = locale)

        if (languageResult is ReviewSpeechLanguageResult.Failed) {
            captureFailure(
                stage = languageResult.stage,
                errorCode = languageResult.errorCode,
                languageStatus = languageResult.languageStatus,
                languageTag = languageTag,
                voiceName = languageResult.voiceName
            )
            request.onError(unavailableMessage)
            return
        }

        val utteranceId = UUID.randomUUID().toString().lowercase(Locale.US)
        activeUtterance = ActiveReviewSpeechUtterance(
            utteranceId = utteranceId,
            languageTag = languageTag,
            languageStatus = languageResult.languageStatus,
            voiceName = languageResult.voiceName,
            onError = request.onError
        )
        activeSide = request.side

        val speakResult = controller.speak(
            request.speakableText,
            TextToSpeech.QUEUE_FLUSH,
            null,
            utteranceId
        )

        if (speakResult == TextToSpeech.ERROR) {
            activeUtterance = null
            activeSide = null
            captureFailure(
                stage = AndroidReviewSpeechFailureStage.SPEAK,
                errorCode = speakResult,
                languageStatus = languageResult.languageStatus,
                languageTag = languageTag,
                voiceName = languageResult.voiceName
            )
            request.onError(unavailableMessage)
        }
    }
}

/**
 * Uses the engine's own default voice whenever setLanguage reports the language available. Otherwise
 * setLanguage leaves the previous voice in place, so only an installed voice of the same language may
 * replace it.
 */
private fun applyReviewSpeechLanguage(
    controller: TextToSpeech,
    locale: Locale
): ReviewSpeechLanguageResult {
    val languageStatus = controller.setLanguage(locale)
    if (languageStatus >= TextToSpeech.LANG_AVAILABLE) {
        return ReviewSpeechLanguageResult.Applied(languageStatus = languageStatus, voiceName = null)
    }

    val fallbackVoice = selectInstalledReviewSpeechVoice(
        voices = controller.voices?.toList().orEmpty(),
        locale = locale
    ) ?: return ReviewSpeechLanguageResult.Failed(
        stage = AndroidReviewSpeechFailureStage.SET_LANGUAGE,
        errorCode = null,
        languageStatus = languageStatus,
        voiceName = null
    )

    val voiceStatus = controller.setVoice(fallbackVoice)
    if (voiceStatus != TextToSpeech.SUCCESS) {
        return ReviewSpeechLanguageResult.Failed(
            stage = AndroidReviewSpeechFailureStage.SET_VOICE,
            errorCode = voiceStatus,
            languageStatus = languageStatus,
            voiceName = fallbackVoice.name
        )
    }

    return ReviewSpeechLanguageResult.Applied(languageStatus = languageStatus, voiceName = fallbackVoice.name)
}

// Engines list voices whose data is not downloaded yet; speaking with one fails only asynchronously.
private fun selectInstalledReviewSpeechVoice(
    voices: List<Voice>,
    locale: Locale
): Voice? {
    val languageTag = locale.toLanguageTag().lowercase(Locale.US)
    val primaryLanguage = locale.language.lowercase(Locale.US)

    return voices
        .filter { voice ->
            voice.locale.language.lowercase(Locale.US) == primaryLanguage
                && voice.features.orEmpty().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED).not()
        }
        .minWithOrNull(
            compareBy<Voice>(
                { voice -> voice.locale.toLanguageTag().lowercase(Locale.US) != languageTag },
                { voice -> voice.isNetworkConnectionRequired }
            )
        )
}

private fun localeFromLanguageTag(languageTag: String): Locale {
    return Locale.forLanguageTag(sanitizeReviewSpeechLanguageTag(languageTag = languageTag))
}

private fun sanitizeReviewSpeechLanguageTag(languageTag: String): String {
    val normalizedTag = languageTag.replace(oldValue = "_", newValue = "-").trim()
    if (normalizedTag.isEmpty()) {
        return "en-US"
    }

    return normalizedTag
}

private fun scoreReviewSpeechLanguageHeuristic(
    text: String,
    heuristic: ReviewSpeechLanguageHeuristic
): Int {
    return heuristic.markers.count { marker ->
        text.contains(other = marker)
    }
}

private fun detectReviewSpeechLanguage(
    text: String,
    fallbackLanguageTag: String
): String {
    val normalizedText = " ${text.lowercase(Locale.ROOT)} "

    if (Regex(pattern = "[\\u3040-\\u30ff]").containsMatchIn(normalizedText)) {
        return "ja-JP"
    }
    if (Regex(pattern = "[\\uac00-\\ud7af]").containsMatchIn(normalizedText)) {
        return "ko-KR"
    }
    if (Regex(pattern = "[\\u4e00-\\u9fff]").containsMatchIn(normalizedText)) {
        return "zh-CN"
    }
    if (Regex(pattern = "[\\u0400-\\u04ff]").containsMatchIn(normalizedText)) {
        return "ru-RU"
    }
    if (Regex(pattern = "[\\u0370-\\u03ff]").containsMatchIn(normalizedText)) {
        return "el-GR"
    }
    if (Regex(pattern = "[\\u0590-\\u05ff]").containsMatchIn(normalizedText)) {
        return "he-IL"
    }
    if (Regex(pattern = "[\\u0600-\\u06ff]").containsMatchIn(normalizedText)) {
        return "ar-SA"
    }
    if (Regex(pattern = "[\\u0e00-\\u0e7f]").containsMatchIn(normalizedText)) {
        return "th-TH"
    }
    if (Regex(pattern = "[\\u0900-\\u097f]").containsMatchIn(normalizedText)) {
        return "hi-IN"
    }
    if (Regex(pattern = "[¿¡ñ]").containsMatchIn(normalizedText)) {
        return "es-ES"
    }
    if (Regex(pattern = "[äöüß]").containsMatchIn(normalizedText)) {
        return "de-DE"
    }
    if (Regex(pattern = "[ãõ]").containsMatchIn(normalizedText)) {
        return "pt-PT"
    }
    if (Regex(pattern = "[àèìòù]").containsMatchIn(normalizedText)) {
        return "it-IT"
    }
    if (Regex(pattern = "[çœæ]").containsMatchIn(normalizedText)) {
        return "fr-FR"
    }

    var bestLanguageTag: String? = null
    var bestScore = 0

    reviewSpeechLatinLanguageHeuristics.forEach { heuristic ->
        val score = scoreReviewSpeechLanguageHeuristic(
            text = normalizedText,
            heuristic = heuristic
        )
        if (score > bestScore) {
            bestScore = score
            bestLanguageTag = heuristic.languageTag
        }
    }

    return if (bestLanguageTag != null && bestScore > 0) {
        bestLanguageTag
    } else {
        sanitizeReviewSpeechLanguageTag(languageTag = fallbackLanguageTag)
    }
}
