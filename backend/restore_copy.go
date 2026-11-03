package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
)

func inspectRestoreDatabase(ctx context.Context, db *sql.DB) error {
	var integrity string
	if err := db.QueryRowContext(ctx, "PRAGMA quick_check").Scan(&integrity); err != nil || integrity != "ok" {
		return fmt.Errorf("database integrity check failed")
	}
	var count int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='organizations'").Scan(&count); err != nil || count != 1 {
		return fmt.Errorf("database is not a recognized workspace backup")
	}
	return nil
}

// restoreBackupToNewFile creates an independently inspectable candidate. It
// never replaces the running database or removes an incomplete destination.
func restoreBackupToNewFile(ctx context.Context, source, destination string) error {
	if strings.TrimSpace(source) == "" || strings.TrimSpace(destination) == "" {
		return fmt.Errorf("source and destination are required")
	}
	info, err := os.Lstat(source)
	if err != nil || !info.Mode().IsRegular() {
		return fmt.Errorf("backup source must be an existing regular file")
	}
	sourceURI, err := legacySnapshotReadOnlyURI(source)
	if err != nil {
		return fmt.Errorf("invalid backup source path")
	}
	destinationURI, err := legacySnapshotReadOnlyURI(destination)
	if err != nil {
		return fmt.Errorf("invalid candidate path")
	}
	if _, err = os.Lstat(destination); !os.IsNotExist(err) {
		return fmt.Errorf("candidate destination already exists or cannot be checked")
	}
	db, err := sql.Open("sqlite", sourceURI)
	if err != nil {
		return fmt.Errorf("cannot open backup source")
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	if err = inspectRestoreDatabase(ctx, db); err != nil {
		return err
	}
	reservation, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return fmt.Errorf("cannot reserve candidate destination")
	}
	if err = reservation.Close(); err != nil {
		return fmt.Errorf("cannot close candidate destination; inspect it before retrying")
	}
	if _, err = db.ExecContext(ctx, "VACUUM INTO ?", destination); err != nil {
		return fmt.Errorf("cannot create candidate; inspect the destination before retrying")
	}
	candidate, err := sql.Open("sqlite", destinationURI)
	if err != nil {
		return fmt.Errorf("candidate created but cannot be inspected")
	}
	defer candidate.Close()
	if err = inspectRestoreDatabase(ctx, candidate); err != nil {
		return fmt.Errorf("candidate created but validation failed: %w", err)
	}
	if err = compareRestoreDatabases(ctx, db, candidate); err != nil {
		return fmt.Errorf("candidate created but content verification failed: %w", err)
	}
	return nil
}

func restoreCopyCommand(ctx context.Context, args []string) error {
	if len(args) != 2 {
		return fmt.Errorf("usage: --restore-copy <snapshot> <new-candidate>")
	}
	return restoreBackupToNewFile(ctx, args[0], args[1])
}
