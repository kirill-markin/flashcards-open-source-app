package com.flashcardsopensourceapp.feature.review

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.AssetFileDescriptor
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import com.flashcardsopensourceapp.data.local.model.media.ReviewMediaAssetFile
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException

internal enum class ReviewAudioPlaybackState {
    IDLE,
    LOADING,
    PLAYING,
    FAILED
}

internal class ReviewAudioControl(val mediaAssetId: String)

private data class ReviewAudioStatus(
    val control: ReviewAudioControl,
    val state: ReviewAudioPlaybackState
)

/** Owns one foreground player on the main thread, even when the card shows multiple audio controls. */
internal class ReviewAudioPlayback(
    private val context: Context,
    private val lifecycle: Lifecycle,
    private val scope: CoroutineScope,
    private val loadManagedMediaFile: suspend (String) -> ReviewMediaAssetFile,
    private val onPlaybackRequested: () -> Unit
) {
    private val audioManager = checkNotNull(context.getSystemService(AudioManager::class.java))
    private val audioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .build()
    private var status by mutableStateOf<ReviewAudioStatus?>(value = null)
    private var loadJob: Job? = null
    private var player: MediaPlayer? = null
    private var audioFocus: AudioFocusRequest? = null
    private var audioNoisyReceiverRegistered = false
    private val audioNoisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
                stop()
            }
        }
    }

    fun stateFor(control: ReviewAudioControl): ReviewAudioPlaybackState {
        return status?.takeIf { it.control === control }?.state ?: ReviewAudioPlaybackState.IDLE
    }

    fun toggle(control: ReviewAudioControl) {
        val state = stateFor(control = control)
        if (state == ReviewAudioPlaybackState.LOADING || lifecycle.currentState != Lifecycle.State.RESUMED) {
            return
        }
        stop()
        if (state == ReviewAudioPlaybackState.PLAYING) {
            return
        }

        onPlaybackRequested()
        status = ReviewAudioStatus(control = control, state = ReviewAudioPlaybackState.LOADING)
        loadJob = scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    val mediaFile = loadManagedMediaFile(control.mediaAssetId)
                    val uri = Uri.parse(mediaFile.uri)
                    val descriptor = context.contentResolver.openAssetFileDescriptor(uri, "r")
                        ?: throw IOException("Could not open the cached audio file.")
                    descriptor.use {
                        withContext(Dispatchers.Main.immediate) {
                            prepare(control = control, descriptor = it)
                        }
                    }
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                ensureActive()
                fail(control = control, error = error)
            }
        }
    }

    fun stopIfOwnedBy(control: ReviewAudioControl) {
        if (status?.control === control) {
            stop()
        }
    }

    fun stop() {
        status = null
        loadJob?.cancel()
        loadJob = null
        val playerToRelease = player
        player = null
        playerToRelease?.release()
        audioFocus?.let(audioManager::abandonAudioFocusRequest)
        audioFocus = null
        if (audioNoisyReceiverRegistered) {
            context.unregisterReceiver(audioNoisyReceiver)
            audioNoisyReceiverRegistered = false
        }
    }

    private fun prepare(control: ReviewAudioControl, descriptor: AssetFileDescriptor) {
        val newPlayer = MediaPlayer()
        player = newPlayer
        newPlayer.setAudioAttributes(audioAttributes)
        newPlayer.setOnPreparedListener { preparedPlayer ->
            if (player === preparedPlayer) {
                start(control = control, preparedPlayer = preparedPlayer)
            }
        }
        newPlayer.setOnCompletionListener { completedPlayer ->
            if (player === completedPlayer) {
                stop()
            }
        }
        newPlayer.setOnErrorListener { failedPlayer, what, extra ->
            if (player === failedPlayer) {
                fail(control = control, error = IOException("MediaPlayer failed (what=$what, extra=$extra)."))
            }
            true
        }
        newPlayer.setDataSource(descriptor)
        newPlayer.prepareAsync()
    }

    private fun start(control: ReviewAudioControl, preparedPlayer: MediaPlayer) {
        try {
            val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(audioAttributes)
                .setWillPauseWhenDucked(true)
                .setOnAudioFocusChangeListener { change ->
                    if (change < 0 && player === preparedPlayer) {
                        stop()
                    }
                }
                .build()
            audioFocus = focus
            check(audioManager.requestAudioFocus(focus) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
                "Android denied audio focus for the attachment."
            }
            ContextCompat.registerReceiver(
                context,
                audioNoisyReceiver,
                IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
                ContextCompat.RECEIVER_NOT_EXPORTED
            )
            audioNoisyReceiverRegistered = true
            preparedPlayer.start()
            status = ReviewAudioStatus(control = control, state = ReviewAudioPlaybackState.PLAYING)
        } catch (error: RuntimeException) {
            fail(control = control, error = error)
        }
    }

    private fun fail(control: ReviewAudioControl, error: Exception) {
        Log.w("ReviewAudioPlayback", "event=review_audio_playback_failed mediaAssetId=${control.mediaAssetId}", error)
        stop()
        status = ReviewAudioStatus(control = control, state = ReviewAudioPlaybackState.FAILED)
    }
}
