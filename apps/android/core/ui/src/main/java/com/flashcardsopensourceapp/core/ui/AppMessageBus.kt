package com.flashcardsopensourceapp.core.ui

import android.content.res.Resources
import androidx.core.text.BidiFormatter
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

fun interface TransientMessageController {
    fun showMessage(message: String)
}

fun currentResourceLocale(resources: Resources): Locale {
    return resources.configuration.locales[0] ?: Locale.getDefault()
}

fun bidiWrap(
    text: String,
    locale: Locale
): String {
    return BidiFormatter.getInstance(locale).unicodeWrap(text)
}

class AppMessageBus(
    private val reportTechnicalError: (Throwable) -> Unit,
    private val shouldReportTechnicalError: (Throwable) -> Boolean
) : TransientMessageController, AppTechnicalErrorController {
    private val messagesFlow = MutableSharedFlow<String>(
        replay = 0,
        extraBufferCapacity = 32
    )
    private val activeTechnicalErrorFlow = MutableStateFlow<AppTechnicalError?>(value = null)
    private val reportedTechnicalErrorIds: MutableSet<String> = ConcurrentHashMap.newKeySet()

    val messages: Flow<String> = messagesFlow.asSharedFlow()
    val activeTechnicalError: StateFlow<AppTechnicalError?> = activeTechnicalErrorFlow.asStateFlow()

    override fun showMessage(message: String) {
        messagesFlow.tryEmit(message)
    }

    override fun showTechnicalError(
        error: AppTechnicalError,
        throwable: Throwable
    ) {
        if (reportedTechnicalErrorIds.add(error.reportId) && shouldReportTechnicalError(throwable)) {
            reportTechnicalError(throwable)
        }
        activeTechnicalErrorFlow.value = error
    }

    fun showReportedTechnicalError(error: AppTechnicalError) {
        activeTechnicalErrorFlow.value = error
    }

    fun dismissTechnicalError() {
        activeTechnicalErrorFlow.value = null
    }
}
