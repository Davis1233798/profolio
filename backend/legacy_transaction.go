package main

import (
	"database/sql"
	"fmt"
)

// applyLegacyCandidate performs the data portion of an import in the caller's
// transaction. The caller must establish authorization, backup, idempotency,
// audit and final commit; this function is not an exposed import endpoint.
func applyLegacyCandidate(tx *sql.Tx, organization string, backup legacyBackupPreview, entries []legacyMappingEntry) (int, error) {
	if err := validateLegacyMappings(tx, organization, backup, entries); err != nil {
		return 0, err
	}
	prepared, err := prepareLegacyRows(backup, organization, entries)
	if err != nil {
		return 0, err
	}
	if len(prepared) != len(legacyBackupTables) {
		return 0, fmt.Errorf("incomplete business table manifest")
	}
	if err = validateStagedReferences(prepared); err != nil {
		return 0, err
	}
	if err = validateStagedBusiness(prepared); err != nil {
		return 0, err
	}
	if err = checkLegacyDestinationConflicts(tx, organization, prepared); err != nil {
		return 0, err
	}
	count, err := insertLegacyRows(tx, prepared)
	if err != nil {
		return 0, err
	}
	if err = verifyLegacyStoredRows(tx, prepared); err != nil {
		return 0, err
	}
	return count, nil
}
