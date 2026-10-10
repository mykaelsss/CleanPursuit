-- 003_photo_analysis.sql
-- Gemini's analysis of an uploaded photo, at most one per file.
--
-- The app asks for it right after uploading a report photo and uses it to prefill the
-- report form. The reporter confirms or edits the tags, and report_category/report_hazard
-- record `gemini` as the source of each tag Gemini suggested and the reporter kept.
-- Rows are a snapshot of what the model said, so tag codes are plain arrays checked by
-- the API against trash_category and hazard at analysis time, not foreign keys.

CREATE TYPE terrain AS ENUM ('pavement', 'grass', 'dirt', 'sand', 'woods', 'water_edge', 'other');

CREATE TABLE photo_analysis (
  file_id              uuid PRIMARY KEY REFERENCES file (id) ON DELETE CASCADE,
  model                text NOT NULL,
  shows_litter         boolean NOT NULL,
  -- A suggested report description: what is visible, never handling instructions.
  description          text NOT NULL,
  category_codes       text[] NOT NULL,
  hazard_codes         text[] NOT NULL,
  estimated_bag_count  integer CHECK (estimated_bag_count > 0),
  terrain              terrain NOT NULL,
  -- Usage, for comparing models on cost and speed.
  input_tokens         integer NOT NULL CHECK (input_tokens >= 0),
  output_tokens        integer NOT NULL CHECK (output_tokens >= 0),
  latency_ms           integer NOT NULL CHECK (latency_ms >= 0),
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- For comparing models over time.
CREATE INDEX photo_analysis_model_created_at_idx ON photo_analysis (model, created_at);
