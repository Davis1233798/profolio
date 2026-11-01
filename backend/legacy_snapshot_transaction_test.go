package main

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"
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

func TestLegacySnapshotTransactionBlocksApplicationWrites(t *testing.T) {
	a := appForTest(t)
	snapshot := filepath.Join(t.TempDir(), "before.sqlite")
	entered, release, finished := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	go func() {
		finished <- withLegacySnapshotTransaction(context.Background(), a.db, snapshot, func(*sql.Tx) error { close(entered); <-release; return nil })
	}()
	<-entered
	writerDone := make(chan error, 1)
	go func() {
		_, err := a.db.Exec("INSERT INTO erp_items(id,organization_id,sku,name) VALUES('queued','org','queued','Queued')")
		writerDone <- err
	}()
	select {
	case err := <-writerDone:
		close(release)
		<-finished
		t.Fatalf("write completed during reserved transaction: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	close(release)
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
	if err := <-writerDone; err != nil {
		t.Fatal(err)
	}
	copyDB, err := sql.Open("sqlite", snapshot)
	if err != nil {
		t.Fatal(err)
	}
	defer copyDB.Close()
	var count int
	if err = copyDB.QueryRow("SELECT count(*) FROM erp_items WHERE id='queued'").Scan(&count); err != nil || count != 0 {
		t.Fatalf("snapshot included queued write: %d %v", count, err)
	}
}

func TestLegacySnapshotTransactionRejectsMultipleConnections(t *testing.T) {
	a := appForTest(t)
	a.db.SetMaxOpenConns(2)
	snapshot := filepath.Join(t.TempDir(), "before.sqlite")
	if err := withLegacySnapshotTransaction(context.Background(), a.db, snapshot, func(*sql.Tx) error { return nil }); err == nil {
		t.Fatal("multiple connections accepted")
	}
}
