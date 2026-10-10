-- 003_equipment_seed.sql
-- Curated equipment recommendations for ordinary, non-hazardous cleanup.
-- Keep existing items and mappings; make repeated application safe.

INSERT INTO item (name, description) VALUES
  (
    'Litter grabber',
    'For picking up ordinary litter without direct hand contact. Do not use to handle sharps, suspected biohazards, or unknown chemicals.'
  ),
  (
    'Work gloves',
    'For ordinary litter cleanup only. These are not suitable for needles, suspected biohazards, unknown chemicals, or broken glass requiring puncture protection.'
  ),
  (
    'Heavy-duty trash bags',
    'For ordinary non-hazardous litter. Do not place sharps, biohazards, unknown chemicals, or electronics and batteries in general waste bags.'
  ),
  (
    'Puncture-resistant gloves',
    'For broken glass during ordinary cleanup. Never use these as justification to handle needles or suspected biohazards.'
  ),
  (
    'Closed-toe shoes',
    'Protect feet during cleanup. Especially important where broken glass has been reported.'
  )
ON CONFLICT (name) DO NOTHING;

-- Basic equipment for each report category. Hazard safety rules are applied
-- by the API before any recommendations are returned.
INSERT INTO category_item (category_code, item_id)
SELECT c.code, i.id
FROM trash_category c
CROSS JOIN item i
WHERE i.name IN ('Litter grabber', 'Work gloves')
ON CONFLICT DO NOTHING;

-- Electronics and batteries should not be placed in general waste bags.
INSERT INTO category_item (category_code, item_id)
SELECT c.code, i.id
FROM trash_category c
CROSS JOIN item i
WHERE c.code <> 'electronics'
  AND i.name = 'Heavy-duty trash bags'
ON CONFLICT DO NOTHING;

-- Additional protective equipment for reported broken glass.
INSERT INTO hazard_item (hazard_code, item_id)
SELECT 'broken_glass', i.id
FROM item i
WHERE i.name IN ('Puncture-resistant gloves', 'Closed-toe shoes')
ON CONFLICT DO NOTHING;
