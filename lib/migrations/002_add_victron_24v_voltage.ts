// Embedded SQL for migration 2. Kept in sync with 002_add_victron_24v_voltage.sql.
// The .ts version is what `lib/db.ts` imports because it survives bundling.

export const MIGRATION_002_ADD_VICTRON_24V_VOLTAGE = `
ALTER TABLE samples ADD COLUMN victron_24v_voltage REAL;
`;
