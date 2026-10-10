-- 006_report_place_names.sql
-- A short, readable name for where a report is, such as "Tompkins Square Park, East Village",
-- so the app shows it instead of coordinates. The app suggests one from the phone's geocoder
-- and the reporter can edit it. It is optional: older reports have none, and the geocoder can fail.

ALTER TABLE report
  ADD COLUMN place_name text CHECK (char_length(place_name) BETWEEN 1 AND 120);
