package com.flashcardsopensourceapp.data.local.database

import androidx.room.TypeConverter
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.ReviewRating

class DatabaseTypeConverters {
    @TypeConverter
    fun fromEffortLevel(value: EffortLevel): String {
        return value.name
    }

    @TypeConverter
    fun toEffortLevel(value: String): EffortLevel {
        return EffortLevel.valueOf(value)
    }

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
