package main

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
)

func legacySnapshotReadOnlyURI(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if runtime.GOOS == "windows" {
		volume := filepath.VolumeName(absolute)
		if len(volume) != 2 || volume[1] != ':' {
			return "", fmt.Errorf("snapshot requires a local drive path")
		}
		absolute = "/" + filepath.ToSlash(absolute)
	} else {
		absolute = filepath.ToSlash(absolute)
	}
	return (&url.URL{Scheme: "file", Path: absolute, RawQuery: "mode=ro"}).String(), nil
}

// withLegacySnapshotTransaction reserves the application's only database
// connection across snapshot and transaction. External writers must be stopped
// independently; this helper does not authenticate or expose an import endpoint.
func withLegacySnapshotTransaction(ctx context.Context, db *sql.DB, destination string, apply func(*sql.Tx) error) error {
	if db.Stats().MaxOpenConnections != 1 {
		return fmt.Errorf("snapshot transaction requires a single database connection")
	}
	if destination == "" {
		return fmt.Errorf("snapshot destination required")
	}
	uri, err := legacySnapshotReadOnlyURI(destination)
	if err != nil {
		return fmt.Errorf("invalid snapshot destination")
	}
	if _, err := os.Lstat(destination); !os.IsNotExist(err) {
		return fmt.Errorf("snapshot destination already exists or cannot be checked")
	}
	conn, err := db.Conn(ctx)
	if err != nil {
		return fmt.Errorf("cannot reserve database connection")
	}
	defer conn.Close()
	var before int
	if err = conn.QueryRowContext(ctx, "PRAGMA data_version").Scan(&before); err != nil {
		return fmt.Errorf("cannot inspect database version")
	}
	if _, err = conn.ExecContext(ctx, "VACUUM INTO ?", destination); err != nil {
		return fmt.Errorf("cannot create pre-import snapshot")
	}
	snapshot, err := sql.Open("sqlite", uri)
	if err != nil {
		return fmt.Errorf("cannot inspect pre-import snapshot")
	}
	var integrity string
	err = snapshot.QueryRowContext(ctx, "PRAGMA quick_check").Scan(&integrity)
	closeErr := snapshot.Close()
	if err != nil || closeErr != nil || integrity != "ok" {
		return fmt.Errorf("pre-import snapshot integrity check failed")
	}
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("cannot begin import transaction")
	}
	defer tx.Rollback()
	// Establish the transaction's read snapshot before checking data_version.
	// A concurrent external commit invalidates this attempt; a later write
	// racing the transaction must fail rather than silently overwrite it.
	var schemaCount, after int
	if err = tx.QueryRowContext(ctx, "SELECT count(*) FROM sqlite_master").Scan(&schemaCount); err != nil {
		return fmt.Errorf("cannot establish import snapshot")
	}
	if err = tx.QueryRowContext(ctx, "PRAGMA data_version").Scan(&after); err != nil || before != after {
		return fmt.Errorf("database changed during snapshot; retry with a new backup")
	}
	if err = apply(tx); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("cannot commit import transaction")
	}
	return nil
}
