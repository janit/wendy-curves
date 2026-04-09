// Embedded SQL for migration 3. Kept in sync with 003_add_charge_counters.sql.
export const MIGRATION_003_ADD_CHARGE_COUNTERS = `
ALTER TABLE samples ADD COLUMN victron_charged_kwh REAL;
ALTER TABLE samples ADD COLUMN victron_48v_charged_kwh REAL;
`;
