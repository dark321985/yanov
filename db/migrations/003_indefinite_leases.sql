-- end_date is now the actual first free day, never a planned rental term.
ALTER TABLE leases ADD COLUMN released_on date;
ALTER TABLE leases DROP CONSTRAINT leases_check;
ALTER TABLE leases ADD CONSTRAINT lease_actual_end CHECK (end_date IS NULL OR end_date >= start_date);

-- Preserve completed rentals; active rentals continue until explicitly released.
-- If removing an old planned end would overlap another rental, the exclusion
-- constraint rejects the migration atomically instead of changing occupancy silently.
UPDATE leases SET released_on=end_date
WHERE end_date <= (now() AT TIME ZONE (SELECT timezone FROM app_settings WHERE singleton))::date;
UPDATE leases SET end_date=NULL WHERE released_on IS NULL;
ALTER TABLE leases ADD CONSTRAINT lease_release_consistent CHECK (
  (released_on IS NULL AND end_date IS NULL) OR
  (released_on IS NOT NULL AND end_date IS NOT NULL AND end_date=GREATEST(start_date,released_on))
);
