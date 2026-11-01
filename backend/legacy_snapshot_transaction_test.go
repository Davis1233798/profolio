package main

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
)

func TestLegacySnapshotTransactionRetainsBackupAndRollsBackFailure(t *testing.T) {
	a := appForTest(t)
	snapshot := filepath.Join(t.TempDir(), "before.sqlite")
	if _, err := a.db.Exec("INSERT INTO erp_items(id,organization_id,sku,name) VALUES('before','org','before','Before')"); err != nil {
		t.Fatal(err)
	}
	err := withLegacySnapshotTransaction(context.Background(), a.db, snapshot, func(tx *sql.Tx) error {
		if _, err := tx.Exec("INSERT INTO erp_items(id,organization_id,sku,name) VALUES('after','org','after','After')"); err != nil {
			return err
		}
		return errors.New("reject candidate")
	})
	if err == nil {
		t.Fatal("failure was not propagated")
	}
	var count int
	if err = a.db.QueryRow("SELECT count(*) FROM erp_items WHERE id='after'").Scan(&count); err != nil || count != 0 {
		t.Fatalf("transaction not rolled back: %d %v", count, err)
	}
	copyDB, err := sql.Open("sqlite", snapshot)
	if err != nil {
		t.Fatal(err)
	}
	defer copyDB.Close()
	if err = copyDB.QueryRow("SELECT count(*) FROM erp_items WHERE id='before'").Scan(&count); err != nil || count != 1 {
		t.Fatalf("snapshot missing original: %d %v", count, err)
	}
	if err = withLegacySnapshotTransaction(context.Background(), a.db, snapshot, func(*sql.Tx) error { return nil }); err == nil {
		t.Fatal("existing snapshot accepted")
	}
}
