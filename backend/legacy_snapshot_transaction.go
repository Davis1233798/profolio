package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
)

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
	if _, err := os.Lstat(destination); !os.IsNotExist(err) {
		return fmt.Errorf("snapshot destination already exists or cannot be checked")
	}
	conn, err := db.Conn(ctx)
	if err != nil {
		return fmt.Errorf("cannot reserve database connection")
	}
	defer conn.Close()
	if _, err = conn.ExecContext(ctx, "VACUUM INTO ?", destination); err != nil {
		return fmt.Errorf("cannot create pre-import snapshot")
	}
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("cannot begin import transaction")
	}
	defer tx.Rollback()
	if err = apply(tx); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("cannot commit import transaction")
	}
	return nil
}
