package com.flashcardsopensourceapp.app.store

import android.app.Activity
import android.content.Context
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClient.BillingResponseCode
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import com.android.billingclient.api.queryProductDetails
import com.android.billingclient.api.queryPurchasesAsync
import com.flashcardsopensourceapp.core.observability.analytics.Analytics
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsEvent
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsPurchaseOfferType
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsPurchaseOutcome
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsPurchaseRestoreOutcome
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsSurface
import com.flashcardsopensourceapp.data.local.repository.billing.GoogleBillingAccount
import com.flashcardsopensourceapp.data.local.repository.billing.GoogleBillingIdentity
import com.flashcardsopensourceapp.data.local.repository.billing.GoogleBillingIdentityChangedException
import com.flashcardsopensourceapp.data.local.repository.billing.GooglePlayBillingRepository
import com.flashcardsopensourceapp.data.local.cloud.remote.billing.GooglePurchaseIntent
import com.flashcardsopensourceapp.data.local.model.cloud.CloudEntitlementStatus
import kotlin.coroutines.resume
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.job
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

private class GooglePlayBillingException(val responseCode: Int) : IllegalStateException("Google Play billing request failed.")

/** An opened purchase sheet whose `purchase_finished` has not been reported yet. */
private data class GooglePlayPurchaseReport(val analyticsSurface: AnalyticsSurface?)

class GooglePlaySubscriptionConnector(
    context: Context,
    private val repository: GooglePlayBillingRepository,
    private val analytics: Analytics
) : DefaultLifecycleObserver {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val mutex = Mutex()
    private val pendingStore = GooglePlaySubscriptionPendingStore(context.noBackupFilesDir)
    private val offerState = MutableStateFlow<GooglePlaySubscriptionOfferState>(GooglePlaySubscriptionOfferState.NotLoaded)
    private val operationState = MutableStateFlow<GooglePlaySubscriptionOperationState>(GooglePlaySubscriptionOperationState.Idle)
    val offer: StateFlow<GooglePlaySubscriptionOfferState> = offerState.asStateFlow()
    val operation: StateFlow<GooglePlaySubscriptionOperationState> = operationState.asStateFlow()
    private var launchedAccount: GoogleBillingAccount? = null
    // Lives only in memory: a sheet whose result arrives after process death reports no outcome.
    private var pendingPurchaseReport: GooglePlayPurchaseReport? = null
    private var failurePhase = GooglePlaySubscriptionFailurePhase.PURCHASE_RECOVERY
    private var connectedOnce = false
    private var closed = false
    private val billingClient = BillingClient.newBuilder(context.applicationContext)
        .setListener { result, purchases ->
            runOperation {
                reportPurchaseFinished(outcome = purchaseOutcome(result.responseCode, purchases.orEmpty()))
                when (result.responseCode) {
                    BillingResponseCode.OK -> processPurchaseUpdates(purchases.orEmpty())
                    BillingResponseCode.USER_CANCELED -> clearLaunch()
                    // An owned item requires deliberate Restore before it may change app owners.
                    BillingResponseCode.ITEM_ALREADY_OWNED -> {
                        clearLaunch()
                        recoverPurchases()
                    }
                    else -> {
                        clearLaunch()
                        throw GooglePlayBillingException(result.responseCode)
                    }
                }
            }
        }
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .enableAutoServiceReconnection()
        .build()

    init {
        scope.launch {
            repository.observeIdentity().collect { identity ->
                val stateIdentity = when (val state = operationState.value) {
                    is GooglePlaySubscriptionOperationState.Purchasing -> state.identity
                    is GooglePlaySubscriptionOperationState.Pending -> state.identity
                    is GooglePlaySubscriptionOperationState.Verifying -> state.identity
                    is GooglePlaySubscriptionOperationState.Complete -> state.identity
                    else -> null
                }
                if (stateIdentity != null && stateIdentity != identity) {
                    operationState.value = GooglePlaySubscriptionOperationState.Idle
                }
            }
        }
    }

    override fun onResume(owner: LifecycleOwner) {
        resume()
    }

    override fun onDestroy(owner: LifecycleOwner) {
        close()
    }

    fun close() {
        if (closed) return
        closed = true
        scope.cancel()
        billingClient.endConnection()
    }

    suspend fun closeAndJoin() {
        close()
        scope.coroutineContext.job.join()
    }

    fun loadOffer(): Job = runOperation {
        offerState.value = GooglePlaySubscriptionOfferState.Loading
        try {
            connect()
            val result = billingClient.queryProductDetails(
                QueryProductDetailsParams.newBuilder().setProductList(
                    listOf(QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(googlePlayPremiumProductId)
                        .setProductType(BillingClient.ProductType.SUBS).build())
                ).build()
            )
            requireBillingSuccess(result.billingResult)
            val selected = result.productDetailsList.orEmpty()
                .firstOrNull { details -> details.productId == googlePlayPremiumProductId }
                ?.let(::selectGooglePlaySubscriptionOffer)
            offerState.value = if (selected == null) GooglePlaySubscriptionOfferState.Unavailable
                else GooglePlaySubscriptionOfferState.Available(selected)
        } catch (error: CancellationException) {
            offerState.value = GooglePlaySubscriptionOfferState.NotLoaded
            throw error
        } catch (error: Exception) {
            offerState.value = GooglePlaySubscriptionOfferState.Failed(GooglePlaySubscriptionFailure.STORE_UNAVAILABLE)
            throw error
        }
    }

    fun refreshEntitlement(): Job = runOperation {
        failurePhase = GooglePlaySubscriptionFailurePhase.ENTITLEMENT
        operationState.value = GooglePlaySubscriptionOperationState.Loading
        checkNotNull(repository.refreshEntitlement()) { "The server did not return the current account entitlement." }
        operationState.value = GooglePlaySubscriptionOperationState.Idle
    }

    fun purchase(
        activity: Activity,
        displayedOffer: GooglePlaySubscriptionOffer,
        analyticsSurface: AnalyticsSurface?
    ): Job = runOperation {
        if (launchedAccount != null) return@runOperation
        val available = offerState.value as? GooglePlaySubscriptionOfferState.Available
        if (available?.offer !== displayedOffer) {
            operationState.value = GooglePlaySubscriptionOperationState.Failed(
                GooglePlaySubscriptionFailure.OFFER_CHANGED, null, GooglePlaySubscriptionFailurePhase.PURCHASE_PREPARATION
            )
            return@runOperation
        }
        failurePhase = GooglePlaySubscriptionFailurePhase.PURCHASE_PREPARATION
        operationState.value = GooglePlaySubscriptionOperationState.Loading
        connect()
        val account = repository.preparePurchase()
        repository.withCurrentIdentity(account.identity) {
            val entitlement = checkNotNull(repository.refreshEntitlement()) {
                "The server did not return the current account entitlement."
            }
            if (entitlement.tierRank >= 20 && entitlement.status != CloudEntitlementStatus.NONE) {
                operationState.value = GooglePlaySubscriptionOperationState.Complete(account.identity, entitlement)
                return@withCurrentIdentity
            }
            val pending = loadPending()
            savePending(GooglePlayPendingState(launch = account, pendingLaunchToken = null, purchases = pending.purchases))
            withContext(Dispatchers.Main.immediate) {
                failurePhase = GooglePlaySubscriptionFailurePhase.PURCHASE_RECOVERY
                launchedAccount = account
                operationState.value = GooglePlaySubscriptionOperationState.Purchasing(account.identity)
                analytics.track(event = AnalyticsEvent.PurchaseStarted(
                    offerType = purchaseOfferType(displayedOffer),
                    screen = analyticsSurface
                ))
                val result = billingClient.launchBillingFlow(
                    activity,
                    BillingFlowParams.newBuilder()
                        .setObfuscatedAccountId(account.obfuscatedAccountId)
                        .setProductDetailsParamsList(listOf(BillingFlowParams.ProductDetailsParams.newBuilder()
                            .setProductDetails(displayedOffer.productDetails)
                            .setOfferToken(displayedOffer.offerToken).build()))
                        .build()
                )
                if (result.responseCode == BillingResponseCode.OK) {
                    // The sheet opened. Its outcome reaches the purchases listener, whose operation
                    // waits for this one's lock, so the report is in place before it runs.
                    pendingPurchaseReport = GooglePlayPurchaseReport(analyticsSurface = analyticsSurface)
                } else {
                    analytics.track(event = AnalyticsEvent.PurchaseFinished(
                        outcome = purchaseOutcome(result.responseCode, emptyList()),
                        screen = analyticsSurface
                    ))
                }
                when (result.responseCode) {
                    BillingResponseCode.OK -> Unit
                    BillingResponseCode.USER_CANCELED -> clearLaunch()
                    BillingResponseCode.ITEM_ALREADY_OWNED -> {
                        clearLaunch()
                        recoverPurchases()
                    }
                    else -> {
                        clearLaunch()
                        throw GooglePlayBillingException(result.responseCode)
                    }
                }
            }
        }
    }

    fun restore(analyticsSurface: AnalyticsSurface?): Job = runOperation {
        launchedAccount = null
        operationState.value = GooglePlaySubscriptionOperationState.Loading
        // Only Play's answer is reported: a session failure before the query and the server's
        // verification after it are not what the store returned.
        val identity = repository.prepareRestore()
        val purchases = try {
            queryPurchases()
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            trackRestoreFinished(outcome = AnalyticsPurchaseRestoreOutcome.FAILED, analyticsSurface = analyticsSurface)
            throw error
        }
        trackRestoreFinished(
            outcome = if (purchases.isEmpty()) AnalyticsPurchaseRestoreOutcome.NOTHING_TO_RESTORE
                else AnalyticsPurchaseRestoreOutcome.RESTORED,
            analyticsSurface = analyticsSurface
        )
        if (purchases.isEmpty()) {
            operationState.value = GooglePlaySubscriptionOperationState.NothingToRestore
        }
        for (purchase in purchases) {
            processPurchase(purchase, identity, GooglePurchaseIntent.EXPLICIT)
        }
    }

    fun resume(): Job = runOperation { recoverPurchases() }

    // A user retry may repeat the original explicit request, but automatic replay is always passive.
    fun retryVerification(): Job = runOperation {
        val identity = repository.currentIdentity() ?: throw GoogleBillingIdentityChangedException()
        val pending = loadPending().purchases.filter { purchase -> purchase.identity == identity }
        if (pending.isEmpty()) {
            recoverPurchases()
        } else {
            for (purchase in pending) {
                verify(purchase, purchase.intent)
            }
        }
    }

    private suspend fun recoverPurchases() {
        val identity = repository.currentIdentity() ?: return
        val purchases = queryPurchases()
        val stored = loadPending()
        // An empty query while the purchase sheet is open does not establish cancellation.
        // Only release a launch after Play has reported its pending payment and then removed it.
        if (stored.pendingLaunchToken != null &&
            purchases.none { purchase -> purchase.purchaseToken == stored.pendingLaunchToken } &&
            stored.purchases.none { purchase -> purchase.token == stored.pendingLaunchToken }
        ) {
            clearLaunch()
        }
        if (purchases.isEmpty() && stored.purchases.none { record -> record.identity == identity } && launchedAccount == null) {
            operationState.value = GooglePlaySubscriptionOperationState.Idle
        }
        for (purchase in purchases) {
            val previous = stored.purchases.firstOrNull { pending -> pending.token == purchase.purchaseToken }
            val launch = stored.launch?.takeIf { account ->
                account.obfuscatedAccountId == purchase.accountIdentifiers?.obfuscatedAccountId
            }
            val originalIdentity = previous?.identity ?: launch?.identity ?: identity
            if (originalIdentity != identity) {
                throw GoogleBillingIdentityChangedException()
            }
            processPurchase(purchase, identity, GooglePurchaseIntent.PASSIVE)
        }
        // Verification may have succeeded server-side before the process died; retain and replay
        // the token even when Play no longer lists it (for example after a later expiration).
        for (purchase in stored.purchases.filter { record ->
            record.identity == identity && purchases.none { owned -> owned.purchaseToken == record.token }
        }) {
            verify(purchase, GooglePurchaseIntent.PASSIVE)
        }
    }

    private suspend fun processPurchaseUpdates(purchases: List<Purchase>) {
        val identity = repository.currentIdentity() ?: throw GoogleBillingIdentityChangedException()
        val stored = loadPending()
        for (purchase in purchases.filter { item -> item.products.contains(googlePlayPremiumProductId) }) {
            val launch = launchedAccount?.takeIf { account ->
                account.obfuscatedAccountId == purchase.accountIdentifiers?.obfuscatedAccountId
            }
            val original = stored.purchases.firstOrNull { item -> item.token == purchase.purchaseToken }?.identity
                ?: stored.launch?.takeIf { account ->
                    account.obfuscatedAccountId == purchase.accountIdentifiers?.obfuscatedAccountId
                }?.identity
                ?: launch?.identity
                ?: identity
            if (original != identity) throw GoogleBillingIdentityChangedException()
            processPurchase(purchase, identity, if (launch != null) GooglePurchaseIntent.EXPLICIT else GooglePurchaseIntent.PASSIVE)
        }
    }

    private suspend fun processPurchase(purchase: Purchase, identity: GoogleBillingIdentity, intent: GooglePurchaseIntent) {
        when (purchase.purchaseState) {
            Purchase.PurchaseState.PENDING -> {
                repository.withCurrentIdentity(identity) {
                    val state = loadPending()
                    if (state.launch?.identity == identity &&
                        state.launch.obfuscatedAccountId == purchase.accountIdentifiers?.obfuscatedAccountId
                    ) {
                        savePending(GooglePlayPendingState(
                            launch = state.launch,
                            pendingLaunchToken = purchase.purchaseToken,
                            purchases = state.purchases
                        ))
                    }
                    operationState.value = GooglePlaySubscriptionOperationState.Pending(identity)
                }
            }
            Purchase.PurchaseState.PURCHASED -> {
                val state = loadPending()
                val existing = state.purchases.firstOrNull { item -> item.token == purchase.purchaseToken }
                val record = GooglePlayPendingPurchase(
                    token = purchase.purchaseToken,
                    identity = identity,
                    intent = if (
                        (existing?.identity == identity && existing.intent == GooglePurchaseIntent.EXPLICIT) ||
                        (state.launch?.identity == identity &&
                            state.launch.obfuscatedAccountId == purchase.accountIdentifiers?.obfuscatedAccountId)
                    ) GooglePurchaseIntent.EXPLICIT else intent
                )
                savePending(GooglePlayPendingState(
                    launch = state.launch,
                    pendingLaunchToken = state.pendingLaunchToken,
                    purchases = state.purchases.filterNot { item -> item.token == record.token } + record
                ))
                verify(record, intent)
            }
            else -> throw GooglePlayBillingException(BillingResponseCode.ERROR)
        }
    }

    private suspend fun verify(purchase: GooglePlayPendingPurchase, intent: GooglePurchaseIntent) {
        repository.withCurrentIdentity(purchase.identity) {
            verifyForCurrentIdentity(purchase, intent)
        }
    }

    private suspend fun verifyForCurrentIdentity(purchase: GooglePlayPendingPurchase, intent: GooglePurchaseIntent) {
        operationState.value = GooglePlaySubscriptionOperationState.Verifying(purchase.identity)
        val entitlement = repository.verifyPurchase(purchase.identity, purchase.token, intent)
        if (entitlement == null) {
            operationState.value = GooglePlaySubscriptionOperationState.Failed(
                GooglePlaySubscriptionFailure.VERIFICATION_FAILED, null, GooglePlaySubscriptionFailurePhase.PURCHASE_RECOVERY
            )
            return
        }
        val pending = loadPending()
        savePending(GooglePlayPendingState(
            launch = pending.launch?.takeUnless { account -> account.identity == purchase.identity },
            pendingLaunchToken = pending.pendingLaunchToken.takeUnless { pending.launch?.identity == purchase.identity },
            purchases = pending.purchases.filterNot { item -> item.token == purchase.token }
        ))
        launchedAccount = null
        operationState.value = if (entitlement.tierRank >= 20 && entitlement.status != CloudEntitlementStatus.NONE) {
            GooglePlaySubscriptionOperationState.Complete(purchase.identity, entitlement)
        } else {
            GooglePlaySubscriptionOperationState.Failed(
                GooglePlaySubscriptionFailure.ENTITLEMENT_NOT_GRANTED, null, GooglePlaySubscriptionFailurePhase.PURCHASE_RECOVERY
            )
        }
    }

    private fun reportPurchaseFinished(outcome: AnalyticsPurchaseOutcome) {
        val report = pendingPurchaseReport ?: return
        pendingPurchaseReport = null
        analytics.track(event = AnalyticsEvent.PurchaseFinished(outcome = outcome, screen = report.analyticsSurface))
    }

    private fun trackRestoreFinished(outcome: AnalyticsPurchaseRestoreOutcome, analyticsSurface: AnalyticsSurface?) {
        analytics.track(event = AnalyticsEvent.PurchaseRestoreFinished(outcome = outcome, screen = analyticsSurface))
    }

    private suspend fun clearLaunch() {
        launchedAccount = null
        val pending = loadPending()
        savePending(GooglePlayPendingState(launch = null, pendingLaunchToken = null, purchases = pending.purchases))
        operationState.value = GooglePlaySubscriptionOperationState.Idle
    }

    private suspend fun queryPurchases(): List<Purchase> {
        connect()
        val result = billingClient.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build()
        )
        requireBillingSuccess(result.billingResult)
        return result.purchasesList.filter { purchase -> purchase.products.contains(googlePlayPremiumProductId) }
    }

    private suspend fun connect() {
        check(!closed) { "Google Play billing connector is closed." }
        if (connectedOnce) return
        val result: BillingResult = suspendCancellableCoroutine { continuation ->
            billingClient.startConnection(object : BillingClientStateListener {
                override fun onBillingSetupFinished(result: BillingResult) {
                    if (continuation.isActive) continuation.resume(result)
                }
                override fun onBillingServiceDisconnected() {
                    if (continuation.isActive) {
                        continuation.resume(BillingResult.newBuilder()
                            .setResponseCode(BillingResponseCode.SERVICE_DISCONNECTED).build())
                    }
                    // enableAutoServiceReconnection reconnects on the next BillingClient request.
                }
            })
        }
        requireBillingSuccess(result)
        connectedOnce = true
    }

    private fun runOperation(block: suspend () -> Unit): Job = scope.launch {
        mutex.withLock {
            // Purchase callbacks can fail while loading storage, before Verifying is published.
            failurePhase = GooglePlaySubscriptionFailurePhase.PURCHASE_RECOVERY
            try {
                block()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                operationState.value = GooglePlaySubscriptionOperationState.Failed(
                    failure = when (error) {
                        is GoogleBillingIdentityChangedException -> GooglePlaySubscriptionFailure.IDENTITY_CHANGED
                        is GooglePlaySubscriptionStorageException -> GooglePlaySubscriptionFailure.LOCAL_STORAGE_FAILED
                        is GooglePlayBillingException -> GooglePlaySubscriptionFailure.PURCHASE_FAILED
                        else -> GooglePlaySubscriptionFailure.VERIFICATION_FAILED
                    },
                    responseCode = (error as? GooglePlayBillingException)?.responseCode,
                    phase = failurePhase
                )
            }
        }
    }

    private suspend fun loadPending(): GooglePlayPendingState = withContext(Dispatchers.IO) { pendingStore.load() }
    private suspend fun savePending(state: GooglePlayPendingState) = withContext(Dispatchers.IO) { pendingStore.save(state) }
}

private fun purchaseOutcome(responseCode: Int, purchases: List<Purchase>): AnalyticsPurchaseOutcome {
    val premiumStates = purchases
        .filter { purchase -> purchase.products.contains(googlePlayPremiumProductId) }
        .map { purchase -> purchase.purchaseState }
    return when {
        responseCode == BillingResponseCode.USER_CANCELED -> AnalyticsPurchaseOutcome.CANCELLED
        responseCode != BillingResponseCode.OK -> AnalyticsPurchaseOutcome.FAILED
        premiumStates.contains(Purchase.PurchaseState.PURCHASED) -> AnalyticsPurchaseOutcome.COMPLETED
        premiumStates.contains(Purchase.PurchaseState.PENDING) -> AnalyticsPurchaseOutcome.PENDING
        else -> AnalyticsPurchaseOutcome.FAILED
    }
}

private fun purchaseOfferType(offer: GooglePlaySubscriptionOffer): AnalyticsPurchaseOfferType {
    return if (googlePlaySubscriptionOfferHasFreeTrial(offer)) AnalyticsPurchaseOfferType.FREE_TRIAL
        else AnalyticsPurchaseOfferType.STANDARD
}

private fun requireBillingSuccess(result: BillingResult) {
    if (result.responseCode != BillingResponseCode.OK) throw GooglePlayBillingException(result.responseCode)
}
