-- 004_volume_estimates.sql
-- Trash amounts become a low and high volume estimate in US gallons instead of a bag count.
-- The API works out bag counts for common bag sizes from the range, and the difficulty tier
-- uses a point a third of the way up it.
--
-- report.estimated_bag_count is kept for now, so code that still reads it keeps working on
-- the shared DEV service. Drop it in a later migration once nothing uses it.

ALTER TABLE report
  ADD COLUMN estimated_volume_min_gallons integer,
  ADD COLUMN estimated_volume_max_gallons integer,
  ADD CONSTRAINT report_estimated_volume_check CHECK (
    (estimated_volume_min_gallons IS NULL) = (estimated_volume_max_gallons IS NULL)
    AND estimated_volume_min_gallons > 0
    AND estimated_volume_max_gallons >= estimated_volume_min_gallons
  );

-- Carry over existing bag counts as 13-gallon kitchen bags.
UPDATE report
SET estimated_volume_min_gallons = estimated_bag_count * 13,
    estimated_volume_max_gallons = estimated_bag_count * 13
WHERE estimated_bag_count IS NOT NULL;

-- Only the analysis endpoint on this branch reads photo_analysis, so it changes in place.
ALTER TABLE photo_analysis
  ADD COLUMN estimated_volume_min_gallons integer,
  ADD COLUMN estimated_volume_max_gallons integer,
  ADD CONSTRAINT photo_analysis_estimated_volume_check CHECK (
    (estimated_volume_min_gallons IS NULL) = (estimated_volume_max_gallons IS NULL)
    AND estimated_volume_min_gallons > 0
    AND estimated_volume_max_gallons >= estimated_volume_min_gallons
  );

UPDATE photo_analysis
SET estimated_volume_min_gallons = estimated_bag_count * 13,
    estimated_volume_max_gallons = estimated_bag_count * 13
WHERE estimated_bag_count IS NOT NULL;

ALTER TABLE photo_analysis DROP COLUMN estimated_bag_count;
