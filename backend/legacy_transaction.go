package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// verifyLegacyImportSession must run inside the write transaction, after the
// snapshot, so logout or account deactivation cannot race the import.
func verifyLegacyImportSession(tx *sql.Tx, id *Identity, sessionToken string) error {
	if len(sessionToken) != 64 {
		return fmt.Errorf("session expired")
	}
	var count int
	err := tx.QueryRow(`SELECT count(*) FROM station_sessions s JOIN station_accounts a ON a.user_id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND a.disabled=0 AND a.user_id=? AND a.organization_id=?`, digest(sessionToken), time.Now().UnixMilli(), id.UserID, id.OrganizationID).Scan(&count)
	if err != nil || count != 1 {
		return fmt.Errorf("session expired")
	}
	return nil
}

// recordLegacyCandidate makes the data write, retry record, and audit entry part
// of one caller-owned transaction. The caller must create a backup; the session
// and grants are rechecked here within the transaction.
func recordLegacyCandidate(tx *sql.Tx, id *Identity, sessionToken string, backup legacyBackupPreview, entries []legacyMappingEntry, key string) (int, error) {
	if backup.Format != "business-suite/v1" || strings.TrimSpace(backup.ExportedAt) == "" {
		return 0, fmt.Errorf("invalid legacy backup envelope")
	}
	if _, err := time.Parse(time.RFC3339Nano, backup.ExportedAt); err != nil {
		return 0, fmt.Errorf("invalid legacy backup export time")
	}
	if len(key) < 8 || len(key) > 128 {
		return 0, fmt.Errorf("invalid import retry key")
	}
	if err := verifyLegacyImportSession(tx, id, sessionToken); err != nil {
		return 0, err
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
	backupRaw, err := json.Marshal(backup)
	if err != nil {
		return 0, fmt.Errorf("invalid backup")
	}
	backupHash := digest(string(backupRaw))
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
	audit, _ := json.Marshal(map[string]any{"rows": count, "sourceOrganization": backup.OrganizationID, "exportedAt": backup.ExportedAt, "format": backup.Format, "requestHash": hash, "backupHash": backupHash})
	_, err = tx.Exec("INSERT INTO idempotency_keys(id,organization_id,key,endpoint,request_hash,response_status,response_body) VALUES(?,?,?,?,?,200,?)", "idem_"+token(), id.OrganizationID, key, endpoint, hash, string(result))
	if err == nil {
		_, err = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,after_value) VALUES(?,?,?,'admin','legacy.import','workspace',?,?)", "audit_"+token(), id.OrganizationID, id.UserID, id.OrganizationID, string(audit))
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
