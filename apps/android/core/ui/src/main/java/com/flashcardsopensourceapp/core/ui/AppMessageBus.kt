package com.flashcardsopensourceapp.core.ui

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow

fun interface TransientMessageController {
    fun showMessage(message: String)
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
