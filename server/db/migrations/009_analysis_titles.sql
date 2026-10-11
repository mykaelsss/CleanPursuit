-- 009_analysis_titles.sql
-- Gemini also suggests a quest title for the photo, so the app can prefill it with the description.
-- The reporter can edit it. Null when the photo shows no litter, and on rows analyzed before this.
-- The limit matches the quest title the API accepts (3 to 80 characters).

ALTER TABLE photo_analysis
  ADD COLUMN title text CHECK (char_length(title) BETWEEN 3 AND 80);
