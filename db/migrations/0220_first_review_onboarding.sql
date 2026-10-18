-- Schemas touched/read explicitly: org, content, auth.

ALTER TABLE org.user_settings
  ADD COLUMN first_review_onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE;

-- Historical authorship includes retired aliases; future writes are explicit client preferences.
UPDATE org.user_settings AS user_settings
SET first_review_onboarding_completed = TRUE
FROM (
  SELECT DISTINCT auth.canonical_account_id(review_events.reviewed_by_user_id) AS user_id
  FROM content.review_events AS review_events
  WHERE review_events.reviewed_by_user_id IS NOT NULL
) AS reviewers
WHERE user_settings.user_id = reviewers.user_id;
