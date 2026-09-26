package com.flashcardsopensourceapp.app.premium

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.flashcardsopensourceapp.app.R
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.data.local.ai.diagnostics.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.feature.settings.ai.OwnOpenAiKeyRoute
import com.flashcardsopensourceapp.feature.settings.ai.OwnOpenAiKeyViewModel
import com.flashcardsopensourceapp.feature.settings.ai.createOwnOpenAiKeyViewModelFactory
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import kotlinx.coroutines.CancellationException

internal const val premiumSheetTag: String = "premium_sheet"
internal const val premiumCloseButtonTag: String = "premium_close"
internal const val premiumAiRefusalTag: String = "premium_ai_refusal"
internal const val premiumOwnKeyButtonTag: String = "premium_own_key"
internal const val premiumSignInButtonTag: String = "premium_sign_in"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PremiumPresentationHost(
    presenter: PremiumPresenter,
    appGraph: AppGraph,
    cloudSettings: CloudSettings,
    onOpenSignIn: () -> Unit
) {
    val reason = presenter.reason ?: return
    var isEditingOwnKey by remember(reason) { mutableStateOf(false) }
    var renewalAtMillis: Long? by remember(reason) { mutableStateOf(null) }
    var usageRefreshFailed by remember(reason) { mutableStateOf(false) }
    val isAiLimit = reason is PremiumReason.AiLimit || reason == PremiumReason.AiLimitPreview
    val locale = LocalConfiguration.current.locales[0]

    LaunchedEffect(reason) {
        if (reason !is PremiumReason.AiLimit) {
            return@LaunchedEffect
        }
        try {
            val usage = appGraph.aiChatRepository.loadAiUsage(workspaceId = cloudSettings.activeWorkspaceId)
            renewalAtMillis = usage.monthEndsAtMillis.takeIf { it > System.currentTimeMillis() }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            usageRefreshFailed = true
            AiChatDiagnosticsLogger.warn(
                event = "premium_ai_usage_refresh_failed",
                fields = listOf(
                    "workspaceId" to cloudSettings.activeWorkspaceId,
                    "errorType" to error::class.java.name
                )
            )
        }
    }

    ModalBottomSheet(
        onDismissRequest = presenter::dismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        modifier = Modifier.testTag(tag = premiumSheetTag)
    ) {
        Column(
            modifier = if (isEditingOwnKey) Modifier.fillMaxHeight(0.9f) else Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(
                    onClick = presenter::dismiss,
                    modifier = Modifier.testTag(tag = premiumCloseButtonTag)
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Close,
                        contentDescription = stringResource(R.string.premium_close)
                    )
                }
            }
            if (isEditingOwnKey) {
                Box(modifier = Modifier.weight(1f)) {
                    PremiumOwnKeyEditor(appGraph = appGraph, onDone = presenter::dismiss)
                }
            } else {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                        .padding(start = 24.dp, end = 24.dp, bottom = 32.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    if (isAiLimit) {
                        Text(
                            text = stringResource(R.string.premium_ai_limit_title),
                            style = MaterialTheme.typography.headlineSmall
                        )
                        Text(
                            text = (reason as? PremiumReason.AiLimit)?.refusal?.message
                                ?: stringResource(R.string.premium_ai_limit_message),
                            modifier = Modifier.testTag(tag = premiumAiRefusalTag)
                        )
                        renewalAtMillis?.let { renewal ->
                            Text(
                                stringResource(
                                    R.string.premium_ai_renewal,
                                    DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM)
                                        .withLocale(locale)
                                        .format(Instant.ofEpochMilli(renewal).atZone(ZoneId.systemDefault()))
                                )
                            )
                        }
                        if (usageRefreshFailed) {
                            Text(
                                text = stringResource(R.string.premium_ai_usage_unavailable),
                                color = MaterialTheme.colorScheme.error
                            )
                        }
                    }
                    if (isAiLimit.not() || (
                            presenter.entitlement != null &&
                                hasPremiumAccess(entitlement = presenter.entitlement).not()
                            )) {
                        PremiumComingSoon()
                    }
                    if (isAiLimit) {
                        Text(stringResource(R.string.premium_own_key_help))
                        Button(
                            onClick = { isEditingOwnKey = true },
                            modifier = Modifier.fillMaxWidth().testTag(tag = premiumOwnKeyButtonTag)
                        ) {
                            Text(stringResource(R.string.premium_own_key_action))
                        }
                        if (cloudSettings.cloudState == CloudAccountState.GUEST) {
                            TextButton(
                                onClick = {
                                    presenter.dismiss()
                                    onOpenSignIn()
                                },
                                modifier = Modifier.fillMaxWidth().testTag(tag = premiumSignInButtonTag)
                            ) {
                                Text(stringResource(R.string.premium_sign_in))
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PremiumComingSoon() {
    Text(
        text = stringResource(R.string.premium_coming_soon_title),
        style = MaterialTheme.typography.headlineSmall
    )
    Text(text = stringResource(R.string.premium_coming_soon_message))
}

@Composable
private fun PremiumOwnKeyEditor(appGraph: AppGraph, onDone: () -> Unit) {
    val owner = remember {
        object : ViewModelStoreOwner {
            override val viewModelStore = ViewModelStore()
        }
    }
    DisposableEffect(owner) {
        onDispose { owner.viewModelStore.clear() }
    }
    val ownKeyViewModel = viewModel<OwnOpenAiKeyViewModel>(
        viewModelStoreOwner = owner,
        factory = createOwnOpenAiKeyViewModelFactory(
            aiChatRepository = appGraph.aiChatRepository,
            cloudAccountRepository = appGraph.cloudAccountRepository,
            applicationContext = LocalContext.current.applicationContext
        )
    )
    val uiState by ownKeyViewModel.uiState.collectAsStateWithLifecycle()
    OwnOpenAiKeyRoute(
        uiState = uiState,
        onUpdateEnabled = ownKeyViewModel::updateEnabled,
        onUpdateApiKey = ownKeyViewModel::updateApiKey,
        onBack = onDone
    )
}
