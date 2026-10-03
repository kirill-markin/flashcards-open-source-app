package com.flashcardsopensourceapp.app.premium

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.flashcardsopensourceapp.app.R
import com.flashcardsopensourceapp.app.store.GooglePlaySubscriptionConnector
import com.flashcardsopensourceapp.app.store.GooglePlaySubscriptionFailure
import com.flashcardsopensourceapp.app.store.GooglePlaySubscriptionFailurePhase
import com.flashcardsopensourceapp.app.store.GooglePlaySubscriptionOfferState
import com.flashcardsopensourceapp.app.store.GooglePlaySubscriptionOperationState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudEntitlement
import com.flashcardsopensourceapp.feature.settings.openExternalUrl
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

@Composable
internal fun PremiumStoreOffer(connector: GooglePlaySubscriptionConnector, entitlement: CloudEntitlement?) {
    val context = LocalContext.current
    val offerState by connector.offer.collectAsStateWithLifecycle()
    val operation by connector.operation.collectAsStateWithLifecycle()
    var hasRequestedOffer by remember(connector) { mutableStateOf(false) }
    LaunchedEffect(connector, operation) {
        if (!hasRequestedOffer && !isBillingOperationBusy(connector.operation.value)) {
            hasRequestedOffer = true
            connector.loadOffer()
        }
    }
    Text(text = stringResource(R.string.premium_title), style = MaterialTheme.typography.headlineSmall)
    Text(stringResource(R.string.premium_benefits))
    if (entitlement == null) {
        Text(
            stringResource(R.string.premium_entitlement_unknown),
            modifier = Modifier.testTag("premium_entitlement_unknown")
        )
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
            val details = premiumOfferDetails(state.offer, context.resources)
            if (details == null) {
                Text(stringResource(R.string.premium_offer_terms_unavailable))
                OfferRetryButton(connector = connector, enabled = !isBillingOperationBusy(operation))
            } else {
                details.phaseDescriptions.forEach { description -> Text(description) }
                Text(details.renewalDescription, style = MaterialTheme.typography.bodyMedium)
                val activity = findBillingActivity(context)
                if (activity == null) {
                    Text(stringResource(R.string.premium_activity_unavailable), color = MaterialTheme.colorScheme.error)
                }
                Button(
                    onClick = { activity?.let { connector.purchase(it, state.offer) } },
                    enabled = activity != null && entitlement != null && !hasPremiumAccess(entitlement) &&
                        !isBillingOperationBusy(operation) && !requiresPurchaseVerification(operation),
                    modifier = Modifier.fillMaxWidth().testTag("premium_purchase")
                ) {
                    Text(details.purchaseLabel)
                }
            }
        }
    }
    PremiumBillingActions(connector = connector)
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
internal fun PremiumBillingActions(connector: GooglePlaySubscriptionConnector) {
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
                                state.phase == GooglePlaySubscriptionFailurePhase.PURCHASE_PREPARATION -> connector.purchase(
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
            onClick = { runAction { connector.restore() } },
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
