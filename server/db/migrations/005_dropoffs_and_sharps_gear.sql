-- 005_dropoffs_and_sharps_gear.sql
-- Sharps drop-off sites come from official open data (NYC Open Data for now) instead of a
-- hand-made list, so dropoff_location gains the fields that data carries and a key to import by.
-- Sharps get a mandatory sharps container, and the sharps and biohazard warnings recommend
-- calling 311 while allowing volunteers to handle it themselves with extreme care.

-- Rows imported from an official dataset, such as NYC Open Data's syringe drop-off sites.
ALTER TYPE dropoff_source ADD VALUE IF NOT EXISTS 'open_data';

ALTER TABLE dropoff_location
  ADD COLUMN external_id  text,         -- the source's key for the row, so re-imports update in place
  ADD COLUMN phone        text,
  ADD COLUMN hours        text,         -- free text from the source, such as "Monday-Friday 9am-5pm"
  ADD COLUMN retired_at   timestamptz,  -- missing from the latest import; hidden from lookups
  ADD CONSTRAINT dropoff_location_source_external_id_key UNIQUE (source, external_id),
  -- Everything except Places rows carries its own details.
  ADD CONSTRAINT dropoff_location_details_check CHECK (
    source = 'google_places' OR (name IS NOT NULL AND address IS NOT NULL AND location IS NOT NULL)
  );

-- Replaced by dropoff_location_details_check, which covers every non-Places source.
ALTER TABLE dropoff_location DROP CONSTRAINT dropoff_location_check1;

CREATE INDEX dropoff_location_active_location_idx ON dropoff_location USING gist (location)
  WHERE retired_at IS NULL AND accepts_sharps;

-- Gear a volunteer must bring, not just should bring.
ALTER TABLE hazard_item ADD COLUMN required boolean NOT NULL DEFAULT false;

-- Drop-off sites in New York State only take sharps in a rigid, puncture-proof container.
INSERT INTO item (name, description) VALUES
  ('Sharps container',
   'A rigid, puncture-proof container with a tight lid, such as a store-bought sharps container or a labeled laundry detergent bottle. Drop-off sites only accept sharps in one.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO hazard_item (hazard_code, item_id, required)
SELECT 'sharps', id, true FROM item WHERE name = 'Sharps container'
ON CONFLICT (hazard_code, item_id) DO UPDATE SET required = true;

UPDATE hazard SET warning_text =
  'Needles or syringes were reported here. The recommended approach is to call 311 so the city collects them. If you choose to handle them yourself, be extremely careful and bring a sharps container.'
WHERE code = 'sharps';

UPDATE hazard SET warning_text =
  'Biological waste was reported here. The recommended approach is to call 311 so the city removes it. If you choose to handle it yourself, be extremely careful.'
WHERE code = 'biohazard';
