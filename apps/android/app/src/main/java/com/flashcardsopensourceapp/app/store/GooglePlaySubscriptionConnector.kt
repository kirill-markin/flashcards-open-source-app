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

class GooglePlaySubscriptionConnector(
    context: Context,
    private val repository: GooglePlayBillingRepository
) : DefaultLifecycleObserver {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val mutex = Mutex()
    private val pendingStore = GooglePlaySubscriptionPendingStore(context.noBackupFilesDir)
    private val offerState = MutableStateFlow<GooglePlaySubscriptionOfferState>(GooglePlaySubscriptionOfferState.NotLoaded)
    private val operationState = MutableStateFlow<GooglePlaySubscriptionOperationState>(GooglePlaySubscriptionOperationState.Idle)
    val offer: StateFlow<GooglePlaySubscriptionOfferState> = offerState.asStateFlow()
    val operation: StateFlow<GooglePlaySubscriptionOperationState> = operationState.asStateFlow()
    private var launchedAccount: GoogleBillingAccount? = null
    private var connectedOnce = false
    private var closed = false
    private val billingClient = BillingClient.newBuilder(context.applicationContext)
        .setListener { result, purchases ->
            runOperation {
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

    fun purchase(activity: Activity, displayedOffer: GooglePlaySubscriptionOffer): Job = runOperation {
        if (launchedAccount != null) return@runOperation
        val available = offerState.value as? GooglePlaySubscriptionOfferState.Available
        if (available?.offer !== displayedOffer) {
            operationState.value = GooglePlaySubscriptionOperationState.Failed(GooglePlaySubscriptionFailure.OFFER_CHANGED, null)
            return@runOperation
        }
        operationState.value = GooglePlaySubscriptionOperationState.Loading
        connect()
        val account = repository.preparePurchase()
        val pending = loadPending()
        savePending(GooglePlayPendingState(launch = account, pendingLaunchToken = null, purchases = pending.purchases))
        repository.withCurrentIdentity(account.identity) {
            withContext(Dispatchers.Main.immediate) {
                launchedAccount = account
                operationState.value = GooglePlaySubscriptionOperationState.Purchasing(account.identity)
                val result = billingClient.launchBillingFlow(
                    activity,
                    BillingFlowParams.newBuilder()
                        .setObfuscatedAccountId(account.obfuscatedAccountId)
                        .setProductDetailsParamsList(listOf(BillingFlowParams.ProductDetailsParams.newBuilder()
                            .setProductDetails(displayedOffer.productDetails)
                            .setOfferToken(displayedOffer.offerToken).build()))
                        .build()
                )
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

    fun restore(): Job = runOperation {
        launchedAccount = null
        operationState.value = GooglePlaySubscriptionOperationState.Loading
        val identity = repository.prepareRestore()
        val purchases = queryPurchases()
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
            operationState.value = GooglePlaySubscriptionOperationState.Failed(GooglePlaySubscriptionFailure.VERIFICATION_FAILED, null)
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
            GooglePlaySubscriptionOperationState.Failed(GooglePlaySubscriptionFailure.ENTITLEMENT_NOT_GRANTED, null)
        }
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
                    responseCode = (error as? GooglePlayBillingException)?.responseCode
                )
            }
        }
    }

    private suspend fun loadPending(): GooglePlayPendingState = withContext(Dispatchers.IO) { pendingStore.load() }
    private suspend fun savePending(state: GooglePlayPendingState) = withContext(Dispatchers.IO) { pendingStore.save(state) }
}

private fun requireBillingSuccess(result: BillingResult) {
    if (result.responseCode != BillingResponseCode.OK) throw GooglePlayBillingException(result.responseCode)
}
