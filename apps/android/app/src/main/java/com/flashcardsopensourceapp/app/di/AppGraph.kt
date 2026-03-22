package com.flashcardsopensourceapp.app.di

import android.content.Context
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.buildAppDatabase
import com.flashcardsopensourceapp.data.local.repository.CardsRepository
import com.flashcardsopensourceapp.data.local.repository.DecksRepository
import com.flashcardsopensourceapp.data.local.repository.LocalCardsRepository
import com.flashcardsopensourceapp.data.local.repository.LocalDecksRepository
import com.flashcardsopensourceapp.data.local.repository.LocalReviewRepository
import com.flashcardsopensourceapp.data.local.repository.LocalSyncRepository
import com.flashcardsopensourceapp.data.local.repository.LocalWorkspaceRepository
import com.flashcardsopensourceapp.data.local.repository.ReviewRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import com.flashcardsopensourceapp.data.local.seed.DemoDataSeeder

class AppGraph(
    context: Context
) {
    val database: AppDatabase = buildAppDatabase(context = context)
    val cardsRepository: CardsRepository = LocalCardsRepository(database = database)
    val decksRepository: DecksRepository = LocalDecksRepository(database = database)
    val workspaceRepository: WorkspaceRepository = LocalWorkspaceRepository(database = database)
    val reviewRepository: ReviewRepository = LocalReviewRepository(database = database)
    val syncRepository: SyncRepository = LocalSyncRepository()

    private val demoDataSeeder = DemoDataSeeder(database = database)

    suspend fun seedDemoDataIfNeeded(currentTimeMillis: Long) {
        demoDataSeeder.seedIfNeeded(currentTimeMillis = currentTimeMillis)
    }
}
