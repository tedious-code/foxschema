/**
 * Static, dialect-agnostic summary of how well each object type survives a
 * cross-dialect migration in FoxSchema today — derived from the actual generator/
 * comparison code paths, not general SQL-standard trivia. Purely informational;
 * shown to the user before they commit to a cross-dialect deploy so gaps (Type,
 * View, Check) are visible up front instead of discovered as a runtime error.
 */
export type ReadinessLevel = 'full' | 'partial' | 'none';

export interface ObjectTypeReadiness {
  objectType: string;
  level: ReadinessLevel;
  note: string;
}

export const CROSS_DIALECT_READINESS: ObjectTypeReadiness[] = [
  { objectType: 'Schema', level: 'full', note: 'Just a name remap to the target schema — no translation needed.' },
  { objectType: 'Table', level: 'full', note: 'Columns are translated via the canonical type system.' },
  { objectType: 'Column', level: 'full', note: 'Canonical type translation; an inexact mapping gets an inline "-- review:" note rather than failing silently.' },
  { objectType: 'Primary Key', level: 'full', note: 'Structural (name + columns) — dialect-agnostic.' },
  { objectType: 'Foreign Key', level: 'full', note: 'Structural; the referenced table is requalified to the target schema.' },
  { objectType: 'Unique Constraint', level: 'full', note: 'Represented as a unique index, translated the same way as Index.' },
  { objectType: 'Check Constraint', level: 'none', note: 'Not read or migrated by FoxSchema at all yet, on any dialect.' },
  { objectType: 'Index', level: 'full', note: "Translated via each dialect's own CREATE INDEX form." },
  { objectType: 'View', level: 'none', note: 'View bodies are dialect-specific SQL and are never auto-translated — a cross-dialect view is flagged MANUAL REVIEW REQUIRED with the original body commented out.' },
  { objectType: 'Type', level: 'none', note: "Each dialect has its own type system (enum/domain/object) with no translation layer between them — migrating a user-defined type cross-dialect can produce invalid DDL for the target." },
  { objectType: 'Sequence', level: 'partial', note: 'Portable across most dialects (start/increment/min/max/cycle/cache), except MySQL has no native sequence support at all — a sequence migrated there will fail to run.' },
];
