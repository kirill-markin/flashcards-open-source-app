-- Migration status: Current / additive.
-- Introduces: empty-array defaults for catalog topic columns during runtime replacement.
-- Schemas touched/read explicitly: catalog.

ALTER TABLE catalog.packages
  ALTER COLUMN topic_tags SET DEFAULT ARRAY[]::TEXT[];

ALTER TABLE catalog.package_versions
  ALTER COLUMN topic_tags SET DEFAULT ARRAY[]::TEXT[];

ALTER TABLE catalog.collections
  ALTER COLUMN topic_tags SET DEFAULT ARRAY[]::TEXT[];
