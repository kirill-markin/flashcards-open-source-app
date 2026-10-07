package com.flashcardsopensourceapp.feature.review

import android.content.Context
import android.icu.util.ULocale
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
    val segments: List<ReviewSpeechSegment>,
    val onError: (String) -> Unit
)

private data class ReviewSpeechSegment(
    val text: String,
    val languageTag: String
)

private data class ReviewSpeechUtterance(
    val utteranceId: String,
    val text: String,
    val locale: Locale,
    val languageStatus: Int,
    val voiceName: String?
)

private data class ActiveReviewSpeechPlayback(
    val utterances: List<ReviewSpeechUtterance>,
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

private enum class ReviewSpeechScriptGroup {
    CJK,
    CYRILLIC,
    GREEK,
    HEBREW,
    ARABIC,
    THAI,
    DEVANAGARI,
    LATIN,
    OTHER
}

private data class ReviewSpeechScriptRun(
    val text: String,
    // Null when the run has no letters at all.
    val scriptGroup: ReviewSpeechScriptGroup?
)

private data class ReviewSpeechLanguageHeuristic(
    val languageTag: String,
    val markers: List<String>
)

private val reviewSpeechLineBreakRegex = Regex(pattern = "\\r\\n|\\r|\\n")

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
    private var activePlayback: ActiveReviewSpeechPlayback? = null
    private var isReleased: Boolean = false

    var activeSide: ReviewSpeechSide? by mutableStateOf(value = null)
        private set

    fun toggleSpeech(
        side: ReviewSpeechSide,
        speakableText: String,
        fallbackLanguageTag: String,
        onError: (String) -> Unit
    ) {
        val segments = splitReviewSpeechSegments(
            speakableText = speakableText,
            fallbackLanguageTag = fallbackLanguageTag
        )
        if (segments.isEmpty()) {
            return
        }

        if (activeSide == side || pendingRequest?.side == side) {
            stop()
            return
        }

        val request = PendingReviewSpeechRequest(
            side = side,
            segments = segments,
            onError = onError
        )

        when (initState) {
            ReviewSpeechInitState.NOT_INITIALIZED -> {
                pendingRequest = request
                initializeTextToSpeech(fallbackLanguageTag = fallbackLanguageTag)
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
        activePlayback = null
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

    private fun initializeTextToSpeech(fallbackLanguageTag: String) {
        if (isReleased || initState != ReviewSpeechInitState.NOT_INITIALIZED) {
            return
        }

        initState = ReviewSpeechInitState.PENDING
        val controller = TextToSpeech(applicationContext) { status ->
            handleInitialization(status = status, fallbackLanguageTag = fallbackLanguageTag)
        }
        textToSpeech = controller
        controller.setOnUtteranceProgressListener(
            object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String) = Unit

                override fun onDone(utteranceId: String) {
                    completeActivePlayback(utteranceId = utteranceId)
                }

                @Deprecated("Required for legacy TextToSpeech callback compatibility.")
                override fun onError(utteranceId: String) {
                    failActiveUtterance(utteranceId = utteranceId, errorCode = null)
                }

                override fun onError(utteranceId: String, errorCode: Int) {
                    failActiveUtterance(utteranceId = utteranceId, errorCode = errorCode)
                }

                override fun onStop(utteranceId: String, interrupted: Boolean) {
                    clearActivePlayback(utteranceId = utteranceId)
                }
            }
        )
    }

    private fun completeActivePlayback(utteranceId: String) {
        mainHandler.post {
            if (activePlayback?.utterances?.last()?.utteranceId == utteranceId) {
                activePlayback = null
                activeSide = null
            }
        }
    }

    private fun clearActivePlayback(utteranceId: String) {
        mainHandler.post {
            if (activePlayback?.utterances?.any { utterance -> utterance.utteranceId == utteranceId } == true) {
                activePlayback = null
                activeSide = null
            }
        }
    }

    // The engine accepts speak() and reports failures such as a not-installed voice only here.
    private fun failActiveUtterance(utteranceId: String, errorCode: Int?) {
        mainHandler.post {
            val playback = activePlayback ?: return@post
            val utterance = playback.utterances.firstOrNull { activeUtterance ->
                activeUtterance.utteranceId == utteranceId
            } ?: return@post

            failActivePlayback(
                stage = AndroidReviewSpeechFailureStage.UTTERANCE_ERROR,
                errorCode = errorCode,
                languageStatus = utterance.languageStatus,
                languageTag = utterance.locale.toLanguageTag(),
                voiceName = utterance.voiceName,
                onError = playback.onError
            )
        }
    }

    private fun failActivePlayback(
        stage: AndroidReviewSpeechFailureStage,
        errorCode: Int?,
        languageStatus: Int,
        languageTag: String,
        voiceName: String?,
        onError: (String) -> Unit
    ) {
        activePlayback = null
        activeSide = null
        textToSpeech?.stop()
        captureFailure(
            stage = stage,
            errorCode = errorCode,
            languageStatus = languageStatus,
            languageTag = languageTag,
            voiceName = voiceName
        )
        onError(unavailableMessage)
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

    private fun handleInitialization(status: Int, fallbackLanguageTag: String) {
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
        captureFailure(
            stage = AndroidReviewSpeechFailureStage.INIT,
            errorCode = status,
            languageStatus = null,
            languageTag = localeFromLanguageTag(languageTag = fallbackLanguageTag).toLanguageTag(),
            voiceName = null
        )
        request?.onError?.invoke(unavailableMessage)
    }

    private fun speak(request: PendingReviewSpeechRequest) {
        val controller = textToSpeech
        if (controller == null) {
            request.onError(unavailableMessage)
            return
        }

        // Every language gets a usable voice before anything is spoken, so a failure speaks nothing.
        val appliedLanguages = mutableMapOf<String, ReviewSpeechLanguageResult>()
        var engineLocale: Locale? = null
        for (languageTag in request.segments.map { segment -> segment.languageTag }.distinct()) {
            val locale = localeFromLanguageTag(languageTag = languageTag)
            val languageResult = applyReviewSpeechLanguage(controller = controller, locale = locale)

            if (languageResult is ReviewSpeechLanguageResult.Failed) {
                captureFailure(
                    stage = languageResult.stage,
                    errorCode = languageResult.errorCode,
                    languageStatus = languageResult.languageStatus,
                    languageTag = locale.toLanguageTag(),
                    voiceName = languageResult.voiceName
                )
                request.onError(unavailableMessage)
                return
            }

            appliedLanguages[languageTag] = languageResult
            engineLocale = locale
        }

        val utterances = request.segments.map { segment ->
            val languageResult = appliedLanguages.getValue(segment.languageTag)
            ReviewSpeechUtterance(
                utteranceId = UUID.randomUUID().toString().lowercase(Locale.US),
                text = segment.text,
                locale = localeFromLanguageTag(languageTag = segment.languageTag),
                languageStatus = languageResult.languageStatus,
                voiceName = languageResult.voiceName
            )
        }
        activePlayback = ActiveReviewSpeechPlayback(utterances = utterances, onError = request.onError)
        activeSide = request.side

        for ((index, utterance) in utterances.withIndex()) {
            // speak() copies the engine's current language and voice into each queued request, and that
            // setting persists between calls, so it is switched only when the language changes.
            if (utterance.locale != engineLocale) {
                val languageResult = applyReviewSpeechLanguage(controller = controller, locale = utterance.locale)
                if (languageResult is ReviewSpeechLanguageResult.Failed) {
                    failActivePlayback(
                        stage = languageResult.stage,
                        errorCode = languageResult.errorCode,
                        languageStatus = languageResult.languageStatus,
                        languageTag = utterance.locale.toLanguageTag(),
                        voiceName = languageResult.voiceName,
                        onError = request.onError
                    )
                    return
                }
                engineLocale = utterance.locale
            }

            val speakResult = controller.speak(
                utterance.text,
                if (index == 0) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD,
                null,
                utterance.utteranceId
            )

            if (speakResult == TextToSpeech.ERROR) {
                failActivePlayback(
                    stage = AndroidReviewSpeechFailureStage.SPEAK,
                    errorCode = speakResult,
                    languageStatus = utterance.languageStatus,
                    languageTag = utterance.locale.toLanguageTag(),
                    voiceName = utterance.voiceName,
                    onError = request.onError
                )
                return
            }
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

/**
 * Every non-empty line is split wherever the letter script changes, and lines never merge, so each
 * line break becomes an utterance boundary and a spoken pause.
 */
private fun splitReviewSpeechSegments(
    speakableText: String,
    fallbackLanguageTag: String
): List<ReviewSpeechSegment> {
    val sanitizedFallbackLanguageTag = sanitizeReviewSpeechLanguageTag(languageTag = fallbackLanguageTag)
    val latinFallbackLanguageTag = makeReviewSpeechLatinFallbackLanguageTag(
        fallbackLanguageTag = sanitizedFallbackLanguageTag
    )
    val cjkLanguageTag = detectReviewSpeechCjkLanguage(text = speakableText)

    return speakableText.split(regex = reviewSpeechLineBreakRegex)
        .map { line -> line.trim() }
        .filter { line -> line.isNotEmpty() }
        .flatMap { line ->
            splitReviewSpeechScriptRuns(line = line).fold(
                initial = emptyList<ReviewSpeechSegment>()
            ) { lineSegments, run ->
                val languageTag = detectReviewSpeechRunLanguage(
                    run = run,
                    cjkLanguageTag = cjkLanguageTag,
                    latinFallbackLanguageTag = latinFallbackLanguageTag,
                    fallbackLanguageTag = sanitizedFallbackLanguageTag
                )
                val previousSegment = lineSegments.lastOrNull()

                if (previousSegment != null && previousSegment.languageTag == languageTag) {
                    lineSegments.dropLast(n = 1) + previousSegment.copy(text = previousSegment.text + run.text)
                } else {
                    lineSegments + ReviewSpeechSegment(text = run.text, languageTag = languageTag)
                }
            }
        }
}

/**
 * Non-letters join the current run and leading ones join the first run. Between two runs, the
 * non-letters after the last whitespace, such as an opening `¿` or `(`, open the following run.
 */
private fun splitReviewSpeechScriptRuns(line: String): List<ReviewSpeechScriptRun> {
    val runs = mutableListOf<ReviewSpeechScriptRun>()
    val runText = StringBuilder()
    val neutralText = StringBuilder()
    var runScriptGroup: ReviewSpeechScriptGroup? = null

    for (codePoint in line.codePoints().toArray()) {
        val scriptGroup = classifyReviewSpeechLetter(codePoint = codePoint)
        if (scriptGroup == null) {
            neutralText.appendCodePoint(codePoint)
            continue
        }

        val currentScriptGroup = runScriptGroup
        if (currentScriptGroup != null && currentScriptGroup != scriptGroup) {
            val lastWhitespaceIndex = neutralText.indexOfLast { character -> character.isWhitespace() }
            val previousRunNeutralLength = if (lastWhitespaceIndex < 0) neutralText.length else lastWhitespaceIndex + 1
            runText.append(neutralText, 0, previousRunNeutralLength)
            runs.add(ReviewSpeechScriptRun(text = runText.toString(), scriptGroup = currentScriptGroup))
            runText.setLength(0)
            neutralText.delete(0, previousRunNeutralLength)
        }

        runText.append(neutralText).appendCodePoint(codePoint)
        neutralText.setLength(0)
        runScriptGroup = scriptGroup
    }

    runText.append(neutralText)
    runs.add(ReviewSpeechScriptRun(text = runText.toString(), scriptGroup = runScriptGroup))
    return runs
}

// Null for neutral characters: non-letters, combining marks included, and Common or Inherited script letters.
private fun classifyReviewSpeechLetter(codePoint: Int): ReviewSpeechScriptGroup? {
    if (Character.isLetter(codePoint).not()) {
        return null
    }

    val script = Character.UnicodeScript.of(codePoint)
    return when {
        isReviewSpeechKana(codePoint = codePoint)
            || isReviewSpeechHangul(codePoint = codePoint)
            || isReviewSpeechHan(codePoint = codePoint) -> ReviewSpeechScriptGroup.CJK
        codePoint in 0x0400..0x04FF || script == Character.UnicodeScript.CYRILLIC -> ReviewSpeechScriptGroup.CYRILLIC
        codePoint in 0x0370..0x03FF || script == Character.UnicodeScript.GREEK -> ReviewSpeechScriptGroup.GREEK
        codePoint in 0x0590..0x05FF || script == Character.UnicodeScript.HEBREW -> ReviewSpeechScriptGroup.HEBREW
        codePoint in 0x0600..0x06FF || script == Character.UnicodeScript.ARABIC -> ReviewSpeechScriptGroup.ARABIC
        codePoint in 0x0E00..0x0E7F || script == Character.UnicodeScript.THAI -> ReviewSpeechScriptGroup.THAI
        codePoint in 0x0900..0x097F || script == Character.UnicodeScript.DEVANAGARI -> ReviewSpeechScriptGroup.DEVANAGARI
        // The ranges above claim Common letters such as `ー` and `〆`; the rest (IPA `ˈ`, ʻokina, `µ`) must not split a word.
        script == Character.UnicodeScript.COMMON || script == Character.UnicodeScript.INHERITED -> null
        script == Character.UnicodeScript.LATIN -> ReviewSpeechScriptGroup.LATIN
        // Scripts without a detection rule keep the fallback voice, never the Latin rule.
        else -> ReviewSpeechScriptGroup.OTHER
    }
}

// Explicit ranges come with each Unicode script because `ー`, `〆`, and half-width kana marks are Script=Common.
private fun isReviewSpeechKana(codePoint: Int): Boolean {
    val script = Character.UnicodeScript.of(codePoint)
    return codePoint in 0x3040..0x30FF
        || codePoint in 0xFF65..0xFF9F
        || script == Character.UnicodeScript.HIRAGANA
        || script == Character.UnicodeScript.KATAKANA
}

private fun isReviewSpeechHangul(codePoint: Int): Boolean {
    return codePoint in 0xAC00..0xD7AF || Character.UnicodeScript.of(codePoint) == Character.UnicodeScript.HANGUL
}

private fun isReviewSpeechHan(codePoint: Int): Boolean {
    return codePoint == 0x3006
        || codePoint in 0x4E00..0x9FFF
        || Character.UnicodeScript.of(codePoint) == Character.UnicodeScript.HAN
}

// Scans every character of the whole text, kana punctuation such as `・` included, so all CJK runs share one language.
private fun detectReviewSpeechCjkLanguage(text: String): String {
    val codePoints = text.codePoints().toArray()
    if (codePoints.any { codePoint -> isReviewSpeechKana(codePoint = codePoint) }) {
        return "ja-JP"
    }
    if (codePoints.any { codePoint -> isReviewSpeechHangul(codePoint = codePoint) }) {
        return "ko-KR"
    }

    return "zh-CN"
}

// A run's language comes from its script group, so non-letters attached to the run never change it.
private fun detectReviewSpeechRunLanguage(
    run: ReviewSpeechScriptRun,
    cjkLanguageTag: String,
    latinFallbackLanguageTag: String,
    fallbackLanguageTag: String
): String {
    return when (run.scriptGroup) {
        ReviewSpeechScriptGroup.CJK -> cjkLanguageTag
        ReviewSpeechScriptGroup.CYRILLIC -> "ru-RU"
        ReviewSpeechScriptGroup.GREEK -> "el-GR"
        ReviewSpeechScriptGroup.HEBREW -> "he-IL"
        ReviewSpeechScriptGroup.ARABIC -> "ar-SA"
        ReviewSpeechScriptGroup.THAI -> "th-TH"
        ReviewSpeechScriptGroup.DEVANAGARI -> "hi-IN"
        ReviewSpeechScriptGroup.LATIN -> detectReviewSpeechLatinLanguage(
            text = run.text,
            fallbackLanguageTag = latinFallbackLanguageTag
        )
        ReviewSpeechScriptGroup.OTHER, null -> fallbackLanguageTag
    }
}

/**
 * Latin text without a language hint keeps the UI language only when that language is normally written
 * in Latin script; a language whose script cannot be resolved counts as Latin.
 */
private fun makeReviewSpeechLatinFallbackLanguageTag(fallbackLanguageTag: String): String {
    val script = ULocale.addLikelySubtags(ULocale.forLanguageTag(fallbackLanguageTag)).script
    if (script.isEmpty() || script == "Latn") {
        return fallbackLanguageTag
    }

    return "en-US"
}

private fun detectReviewSpeechLatinLanguage(
    text: String,
    fallbackLanguageTag: String
): String {
    val normalizedText = " ${text.lowercase(Locale.ROOT)} "

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
