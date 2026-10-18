package com.flashcardsopensourceapp.app.premium

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.flashcardsopensourceapp.app.R
import com.flashcardsopensourceapp.app.store.GooglePlaySubscriptionConnector
import com.flashcardsopensourceapp.app.store.GooglePlaySubscriptionFailure
import com.flashcardsopensourceapp.app.store.GooglePlaySubscriptionFailurePhase
import com.flashcardsopensourceapp.app.store.GooglePlaySubscriptionOfferState
import com.flashcardsopensourceapp.app.store.GooglePlaySubscriptionOperationState
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsPaywallPresentation
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsSurface
import com.flashcardsopensourceapp.data.local.model.cloud.CloudEntitlement
import com.flashcardsopensourceapp.data.local.model.cloud.hasPremiumAccess
import com.flashcardsopensourceapp.feature.settings.openExternalUrl
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

internal sealed interface PremiumAllowanceState {
    data object Loading : PremiumAllowanceState
    data object Failed : PremiumAllowanceState
    data class Available(val monthlyMessages: Int?) : PremiumAllowanceState
}

@Composable
internal fun PremiumFreePlan(onContinueFree: () -> Unit) {
    Surface(
        shape = MaterialTheme.shapes.extraLarge,
        color = MaterialTheme.colorScheme.surfaceContainer,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.fillMaxWidth().testTag("premium_free_plan")
    ) {
        Column(modifier = Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.premium_free_title), style = MaterialTheme.typography.titleLarge)
            Text(stringResource(R.string.premium_free_description))
            Text(stringResource(R.string.premium_free_benefits), style = MaterialTheme.typography.bodyMedium)
            OutlinedButton(
                onClick = onContinueFree,
                modifier = Modifier.fillMaxWidth().testTag("premium_continue_free")
            ) { Text(stringResource(R.string.premium_continue_free)) }
        }
    }
}

@Composable
internal fun PremiumStoreOffer(
    connector: GooglePlaySubscriptionConnector,
    entitlement: CloudEntitlement?,
    analyticsSurface: AnalyticsSurface?,
    presentation: AnalyticsPaywallPresentation?,
    allowance: PremiumAllowanceState,
    onRetryAllowance: () -> Unit,
    onChoosePremium: () -> Unit
) {
    val context = LocalContext.current
    val resources = LocalResources.current
    val offerState by connector.offer.collectAsStateWithLifecycle()
    val operation by connector.operation.collectAsStateWithLifecycle()
    var hasRequestedOffer by remember(connector) { mutableStateOf(false) }
    LaunchedEffect(connector, operation, presentation) {
        if (presentation != null && !hasRequestedOffer && !isBillingOperationBusy(connector.operation.value)) {
            hasRequestedOffer = true
            connector.loadOffer()
        }
    }
    Surface(
        shape = MaterialTheme.shapes.extraLarge,
        color = MaterialTheme.colorScheme.primary.copy(alpha = 0.08f).compositeOver(MaterialTheme.colorScheme.surface),
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary),
        modifier = Modifier.fillMaxWidth().testTag("premium_paid_plan")
    ) {
        Column(modifier = Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(text = stringResource(R.string.premium_title), style = MaterialTheme.typography.titleLarge)
            if (presentation != null) when (allowance) {
                PremiumAllowanceState.Loading -> Text(stringResource(R.string.premium_allowance_loading))
                PremiumAllowanceState.Failed -> {
                    Text(stringResource(R.string.premium_allowance_unavailable))
                    TextButton(onClick = onRetryAllowance, modifier = Modifier.testTag("premium_allowance_retry")) {
                        Text(stringResource(R.string.premium_retry))
                    }
                }
                is PremiumAllowanceState.Available -> Text(
                    text = allowance.monthlyMessages?.let { count ->
                        resources.getQuantityString(R.plurals.premium_ai_messages, count, count)
                    } ?: stringResource(R.string.premium_ai_unlimited),
                    modifier = Modifier.testTag("premium_ai_allowance")
                )
            }
            Text(stringResource(R.string.premium_benefits))
            PremiumCreatorSupport()
            if (presentation == null) {
                Text(stringResource(R.string.premium_preview_notice), modifier = Modifier.testTag("premium_preview"))
            } else {
                if (entitlement == null) {
                    Text(stringResource(R.string.premium_entitlement_unknown), modifier = Modifier.testTag("premium_entitlement_unknown"))
                    if ((operation as? GooglePlaySubscriptionOperationState.Failed)?.phase !=
                        GooglePlaySubscriptionFailurePhase.ENTITLEMENT
                    ) {
                        TextButton(
                            onClick = { connector.refreshEntitlement() },
                            enabled = !isBillingOperationBusy(operation) && !requiresPurchaseVerification(operation),
                            modifier = Modifier.fillMaxWidth().testTag("premium_entitlement_retry")
                        ) { Text(stringResource(R.string.premium_retry_plan)) }
                    }
                }
                when (val state = offerState) {
                    GooglePlaySubscriptionOfferState.Loading, GooglePlaySubscriptionOfferState.NotLoaded -> {
                        CircularProgressIndicator(modifier = Modifier.testTag("premium_offer_loading"))
                        Text(stringResource(R.string.premium_offer_loading))
                    }
                    GooglePlaySubscriptionOfferState.Unavailable -> {
                        Text(stringResource(R.string.premium_offer_unavailable), modifier = Modifier.testTag("premium_offer_unavailable"))
                        OfferRetryButton(connector = connector, enabled = !isBillingOperationBusy(operation))
                    }
                    is GooglePlaySubscriptionOfferState.Failed -> {
                        Text(stringResource(R.string.premium_store_unavailable), color = MaterialTheme.colorScheme.error)
                        OfferRetryButton(connector = connector, enabled = !isBillingOperationBusy(operation))
                    }
                    is GooglePlaySubscriptionOfferState.Available -> {
                        val details = premiumOfferDetails(state.offer, resources)
                        if (details == null) {
                            Text(stringResource(R.string.premium_offer_terms_unavailable))
                            OfferRetryButton(connector = connector, enabled = !isBillingOperationBusy(operation))
                        } else {
                            details.phaseDescriptions.forEach { description -> Text(description) }
                            val activity = findBillingActivity(context)
                            if (activity == null) {
                                Text(stringResource(R.string.premium_activity_unavailable), color = MaterialTheme.colorScheme.error)
                            }
                            Button(
                                onClick = {
                                    activity?.let {
                                        onChoosePremium()
                                        connector.purchase(it, state.offer, analyticsSurface, presentation)
                                    }
                                },
                                enabled = activity != null && entitlement != null && !hasPremiumAccess(entitlement) &&
                                    allowance is PremiumAllowanceState.Available &&
                                    !isBillingOperationBusy(operation) && !requiresPurchaseVerification(operation),
                                modifier = Modifier.fillMaxWidth().testTag("premium_purchase")
                            ) { Text(details.purchaseLabel) }
                            Text(
                                details.renewalDescription,
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.testTag("premium_renewal_terms")
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PremiumCreatorSupport() {
    val name = stringResource(R.string.premium_creator_name)
    val support = stringResource(R.string.premium_creator_support, name)
    val nameStart = support.indexOf(name)
    val text = buildAnnotatedString {
        if (nameStart < 0) {
            append(support)
        } else {
            append(support.substring(0, nameStart))
            withLink(LinkAnnotation.Url(
                url = "https://kirill-markin.com/",
                styles = TextLinkStyles(style = SpanStyle(textDecoration = TextDecoration.Underline))
            )) { append(name) }
            append(support.substring(nameStart + name.length))
        }
    }
    Text(text, style = MaterialTheme.typography.bodyMedium)
}

@Composable
internal fun PremiumLegalLinks() {
    val context = LocalContext.current
    val termsUrl = stringResource(com.flashcardsopensourceapp.feature.settings.R.string.flashcards_terms_of_service_url)
    val privacyUrl = stringResource(com.flashcardsopensourceapp.feature.settings.R.string.flashcards_privacy_policy_url)
    TextButton(
        onClick = { openExternalUrl(context = context, url = termsUrl) },
        modifier = Modifier.fillMaxWidth().testTag("premium_terms")
    ) { Text(stringResource(R.string.premium_terms)) }
    TextButton(
        onClick = { openExternalUrl(context = context, url = privacyUrl) },
        modifier = Modifier.fillMaxWidth().testTag("premium_privacy")
    ) { Text(stringResource(R.string.premium_privacy)) }
}

@Composable
private fun OfferRetryButton(connector: GooglePlaySubscriptionConnector, enabled: Boolean) {
    TextButton(
        onClick = { connector.loadOffer() },
        enabled = enabled,
        modifier = Modifier.fillMaxWidth().testTag("premium_offer_retry")
    ) { Text(stringResource(R.string.premium_retry_offer)) }
}

@Composable
internal fun PremiumBillingActions(
    connector: GooglePlaySubscriptionConnector,
    analyticsSurface: AnalyticsSurface?
) {
    val activity = findBillingActivity(LocalContext.current)
    val operation by connector.operation.collectAsStateWithLifecycle()
    val offer by connector.offer.collectAsStateWithLifecycle()
    val availableOffer = (offer as? GooglePlaySubscriptionOfferState.Available)?.offer
    var isRequesting by remember(connector) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val runAction: (() -> Job) -> Unit = { action ->
        if (!isRequesting) {
            isRequesting = true
            scope.launch {
                try {
                    action().join()
                } finally {
                    isRequesting = false
                }
            }
        }
    }
    val busy = isRequesting || isBillingOperationBusy(operation) || offer == GooglePlaySubscriptionOfferState.Loading
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        val status = billingOperationMessage(operation)
        if (status != null) {
            Text(
                text = stringResource(status),
                color = if (operation is GooglePlaySubscriptionOperationState.Failed) {
                    MaterialTheme.colorScheme.error
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
                modifier = Modifier.testTag("premium_billing_status")
            )
        }
        if (operation == GooglePlaySubscriptionOperationState.Loading ||
            operation is GooglePlaySubscriptionOperationState.Purchasing ||
            operation is GooglePlaySubscriptionOperationState.Verifying
        ) {
            CircularProgressIndicator(modifier = Modifier.testTag("premium_billing_loading"))
        }
        when (val state = operation) {
            is GooglePlaySubscriptionOperationState.Failed -> {
                TextButton(
                    onClick = {
                        runAction {
                            when {
                                state.failure == GooglePlaySubscriptionFailure.OFFER_CHANGED -> connector.loadOffer()
                                state.phase == GooglePlaySubscriptionFailurePhase.ENTITLEMENT -> connector.refreshEntitlement()
                                state.phase == GooglePlaySubscriptionFailurePhase.PURCHASE_PREPARATION -> connector.retryPurchasePreparation(
                                    activity = requireNotNull(activity),
                                    displayedOffer = requireNotNull(availableOffer)
                                )
                                else -> when (state.failure) {
                                    GooglePlaySubscriptionFailure.STORE_UNAVAILABLE,
                                    GooglePlaySubscriptionFailure.OFFER_CHANGED -> connector.loadOffer()
                                    GooglePlaySubscriptionFailure.IDENTITY_CHANGED,
                                    GooglePlaySubscriptionFailure.ENTITLEMENT_NOT_GRANTED,
                                    GooglePlaySubscriptionFailure.PURCHASE_FAILED -> connector.resume()
                                    GooglePlaySubscriptionFailure.VERIFICATION_FAILED,
                                    GooglePlaySubscriptionFailure.LOCAL_STORAGE_FAILED -> connector.retryVerification()
                                }
                            }
                        }
                    },
                    enabled = !busy && (state.phase != GooglePlaySubscriptionFailurePhase.PURCHASE_PREPARATION ||
                        state.failure == GooglePlaySubscriptionFailure.OFFER_CHANGED ||
                        (activity != null && availableOffer != null)),
                    modifier = Modifier.fillMaxWidth().testTag("premium_billing_retry")
                ) { Text(stringResource(R.string.premium_retry)) }
            }
            is GooglePlaySubscriptionOperationState.Pending -> {
                TextButton(
                    onClick = { runAction { connector.resume() } },
                    enabled = !isRequesting,
                    modifier = Modifier.fillMaxWidth().testTag("premium_pending_refresh")
                ) { Text(stringResource(R.string.premium_pending_refresh)) }
            }
            else -> Unit
        }
        TextButton(
            onClick = { runAction { connector.restore(analyticsSurface = analyticsSurface) } },
            enabled = !busy,
            modifier = Modifier.fillMaxWidth().testTag("premium_restore")
        ) { Text(stringResource(R.string.premium_restore)) }
    }
}

internal fun isBillingOperationBusy(state: GooglePlaySubscriptionOperationState): Boolean {
    return state == GooglePlaySubscriptionOperationState.Loading ||
        state is GooglePlaySubscriptionOperationState.Purchasing ||
        state is GooglePlaySubscriptionOperationState.Verifying ||
        state is GooglePlaySubscriptionOperationState.Pending
}

internal fun requiresPurchaseVerification(state: GooglePlaySubscriptionOperationState): Boolean {
    return state is GooglePlaySubscriptionOperationState.Failed &&
        state.phase == GooglePlaySubscriptionFailurePhase.PURCHASE_RECOVERY &&
        state.failure in setOf(
            GooglePlaySubscriptionFailure.VERIFICATION_FAILED,
            GooglePlaySubscriptionFailure.LOCAL_STORAGE_FAILED
        )
}

private fun billingOperationMessage(state: GooglePlaySubscriptionOperationState): Int? {
    if (state is GooglePlaySubscriptionOperationState.Failed) {
        when (state.phase) {
            GooglePlaySubscriptionFailurePhase.ENTITLEMENT -> return R.string.premium_entitlement_refresh_failed
            GooglePlaySubscriptionFailurePhase.PURCHASE_PREPARATION -> return R.string.premium_purchase_preparation_failed
            GooglePlaySubscriptionFailurePhase.PURCHASE_RECOVERY -> Unit
        }
    }
    return when (state) {
        GooglePlaySubscriptionOperationState.Idle -> null
        GooglePlaySubscriptionOperationState.Loading -> R.string.premium_billing_loading
        is GooglePlaySubscriptionOperationState.Purchasing -> R.string.premium_billing_purchasing
        is GooglePlaySubscriptionOperationState.Pending -> R.string.premium_billing_pending
        is GooglePlaySubscriptionOperationState.Verifying -> R.string.premium_billing_verifying
        is GooglePlaySubscriptionOperationState.Complete -> R.string.premium_billing_complete
        GooglePlaySubscriptionOperationState.NothingToRestore -> R.string.premium_nothing_to_restore
        is GooglePlaySubscriptionOperationState.Failed -> when (state.failure) {
            GooglePlaySubscriptionFailure.STORE_UNAVAILABLE -> R.string.premium_store_unavailable
            GooglePlaySubscriptionFailure.OFFER_CHANGED -> R.string.premium_offer_changed
            GooglePlaySubscriptionFailure.IDENTITY_CHANGED -> R.string.premium_identity_changed
            GooglePlaySubscriptionFailure.VERIFICATION_FAILED -> R.string.premium_verification_failed
            GooglePlaySubscriptionFailure.LOCAL_STORAGE_FAILED -> R.string.premium_storage_failed
            GooglePlaySubscriptionFailure.PURCHASE_FAILED -> R.string.premium_purchase_failed
            GooglePlaySubscriptionFailure.ENTITLEMENT_NOT_GRANTED -> R.string.premium_entitlement_not_granted
        }
    }
}

private fun findBillingActivity(context: Context): Activity? {
    return when (context) {
        is Activity -> context
        is ContextWrapper -> findBillingActivity(context.baseContext)
        else -> null
    }
}
