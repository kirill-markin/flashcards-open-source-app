package com.flashcardsopensourceapp.core.ui

import android.content.res.Resources
import androidx.core.text.BidiFormatter
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import java.util.Locale

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

class AppMessageBus : TransientMessageController {
    private val messagesFlow = MutableSharedFlow<String>(
        replay = 0,
        extraBufferCapacity = 32
    )

    val messages: Flow<String> = messagesFlow.asSharedFlow()

    override fun showMessage(message: String) {
        messagesFlow.tryEmit(message)
    }
}
