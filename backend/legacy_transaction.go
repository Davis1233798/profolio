package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
)

// recordLegacyCandidate makes the data write, retry record, and audit entry part
// of one caller-owned transaction. The caller must verify the active session
// and create a backup; grants are rechecked here within the transaction.
func recordLegacyCandidate(tx *sql.Tx, id *Identity, backup legacyBackupPreview, entries []legacyMappingEntry, key string) (int, error) {
	if len(key) < 8 || len(key) > 128 {
		return 0, fmt.Errorf("invalid import retry key")
	}
	for _, site := range sites {
		var count int
		err := tx.QueryRow(`SELECT count(*) FROM station_accounts a JOIN station_grants g ON g.user_id=a.user_id WHERE a.organization_id=? AND a.user_id=? AND a.disabled=0 AND g.site=? AND g.enabled=1 AND g.role='admin' AND g.scope='back'`, id.OrganizationID, id.UserID, site).Scan(&count)
		if err != nil || count != 1 {
			return 0, fmt.Errorf("administrator access to every workspace is required")
		}
	}
	raw, err := json.Marshal(struct {
		Backup  legacyBackupPreview
		Entries []legacyMappingEntry
	}{backup, entries})
	if err != nil {
		return 0, fmt.Errorf("invalid import request")
	}
	hash := digest(id.UserID + "\x00" + string(raw))
	const endpoint = "/station/legacy-import"
	var storedHash, storedBody string
	err = tx.QueryRow("SELECT request_hash,response_body FROM idempotency_keys WHERE organization_id=? AND key=? AND endpoint=?", id.OrganizationID, key, endpoint).Scan(&storedHash, &storedBody)
	if err == nil {
		if hash != storedHash {
			return 0, fmt.Errorf("retry key already used")
		}
		var result struct {
			Rows int `json:"rows"`
		}
		if json.Unmarshal([]byte(storedBody), &result) != nil {
			return 0, fmt.Errorf("invalid stored result")
		}
		return result.Rows, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, fmt.Errorf("cannot inspect retry state")
	}
	count, err := applyLegacyCandidate(tx, id.OrganizationID, backup, entries)
	if err != nil {
		return 0, err
	}
	result, _ := json.Marshal(map[string]any{"rows": count})
	_, err = tx.Exec("INSERT INTO idempotency_keys(id,organization_id,key,endpoint,request_hash,response_status,response_body) VALUES(?,?,?,?,?,200,?)", "idem_"+token(), id.OrganizationID, key, endpoint, hash, string(result))
	if err == nil {
		_, err = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,after_value) VALUES(?,?,?,'admin','legacy.import','workspace',?,?)", "audit_"+token(), id.OrganizationID, id.UserID, id.OrganizationID, string(result))
	}
	if err != nil {
		return 0, fmt.Errorf("cannot record import transaction")
	}
	return count, nil
}

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
