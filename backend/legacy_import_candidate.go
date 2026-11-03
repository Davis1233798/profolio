package main

import (
	"context"
	"database/sql"
)

// importLegacyWithSnapshot composes snapshot and transaction checks for
// internal verification. It is not an HTTP endpoint; callers must stop external
// writers and use a trusted destination path before invoking it.
func importLegacyWithSnapshot(ctx context.Context, db *sql.DB, snapshot string, id *Identity, session string, backup legacyBackupPreview, entries []legacyMappingEntry, key string) (int, error) {
	count := 0
	err := withLegacySnapshotTransaction(ctx, db, snapshot, func(tx *sql.Tx) error {
		var err error
		count, err = recordLegacyCandidate(tx, id, session, backup, entries, key)
		return err
	})
	if err != nil {
		return 0, err
	}
	return count, nil
}
