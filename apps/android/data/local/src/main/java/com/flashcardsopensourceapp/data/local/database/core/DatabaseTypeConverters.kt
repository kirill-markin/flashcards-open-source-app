package com.flashcardsopensourceapp.data.local.database.core

import androidx.room.TypeConverter
import com.flashcardsopensourceapp.data.local.model.scheduling.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.review.ReviewRating

class DatabaseTypeConverters {
    @TypeConverter
    fun fromReviewRating(value: ReviewRating): String {
        return value.name
    }

    @TypeConverter
    fun toReviewRating(value: String): ReviewRating {
        return ReviewRating.valueOf(value)
    }

    @TypeConverter
    fun fromFsrsCardState(value: FsrsCardState): String {
        return value.name
    }

    @TypeConverter
    fun toFsrsCardState(value: String): FsrsCardState {
        return FsrsCardState.valueOf(value)
    }
}
