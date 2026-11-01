package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
)

// offlineImportLegacy is an internal coordinator, not an exposed import API.
// Operators must independently stop all non-cooperating database writers.
func offlineImportLegacy(ctx context.Context, database, snapshot string, id *Identity, session string, backup legacyBackupPreview, entries []legacyMappingEntry, key string) (count int, resultErr error) {
	if id == nil {
		return 0, fmt.Errorf("identity required")
	}
	release, err := acquireMaintenanceLock(database)
	if err != nil {
		return 0, err
	}
	defer func() { resultErr = errors.Join(resultErr, release()) }()
	info, err := os.Lstat(database)
	if err != nil || !info.Mode().IsRegular() {
		return 0, fmt.Errorf("existing regular database required")
	}
	readOnlyURI, err := legacySnapshotReadOnlyURI(database)
	if err != nil {
		return 0, fmt.Errorf("invalid database path")
	}
	uri, err := url.Parse(readOnlyURI)
	if err != nil {
		return 0, fmt.Errorf("invalid database path")
	}
	uri.RawQuery = "mode=rw"
	db, err := sql.Open("sqlite", uri.String())
	if err != nil {
		return 0, fmt.Errorf("cannot open existing database")
	}
	db.SetMaxOpenConns(1)
	defer func() { resultErr = errors.Join(resultErr, db.Close()) }()
	if err = inspectRestoreDatabase(ctx, db); err != nil {
		return 0, err
	}
	if _, err = db.ExecContext(ctx, "PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000"); err != nil {
		return 0, fmt.Errorf("cannot configure existing database")
	}
	return importLegacyWithSnapshot(ctx, db, snapshot, id, session, backup, entries, key)
}
