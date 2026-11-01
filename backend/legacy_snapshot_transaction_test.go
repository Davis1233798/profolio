package main

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestLegacySnapshotReadOnlyURI(t *testing.T) {
	path := filepath.Join(t.TempDir(), "snapshot #1 &.sqlite")
	raw, err := legacySnapshotReadOnlyURI(path)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.ToSlash(path)
	if runtime.GOOS == "windows" && filepath.VolumeName(path) != "" {
		want = "/" + want
	}
	if parsed.Scheme != "file" || parsed.Host != "" || parsed.Path != want || parsed.Query().Get("mode") != "ro" {
		t.Fatalf("incorrect snapshot URI: %q", raw)
	}
}

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
	select {
	case <-entered:
	case err := <-finished:
		t.Fatalf("snapshot transaction did not start: %v", err)
	case <-time.After(10 * time.Second):
		t.Fatal("snapshot transaction did not start in time")
	}
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

func TestLegacySnapshotTransactionSupportsSpecialPath(t *testing.T) {
	a := appForTest(t)
	snapshot := filepath.Join(t.TempDir(), "snapshot #1 &.sqlite")
	if err := withLegacySnapshotTransaction(context.Background(), a.db, snapshot, func(*sql.Tx) error { return nil }); err != nil {
		t.Fatal(err)
	}
}

func TestLegacySnapshotTransactionRejectsExternalWriteAfterSnapshot(t *testing.T) {
	path := filepath.Join(t.TempDir(), "source.sqlite")
	db, err := openDB(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	external, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer external.Close()
	snapshot := filepath.Join(t.TempDir(), "before.sqlite")
	err = withLegacySnapshotTransaction(context.Background(), db, snapshot, func(tx *sql.Tx) error {
		if _, e := external.Exec("INSERT INTO erp_items(id,organization_id,sku,name) VALUES('external','org','external','External')"); e != nil {
			return e
		}
		_, e := tx.Exec("INSERT INTO erp_items(id,organization_id,sku,name) VALUES('import','org','import','Import')")
		return e
	})
	if err == nil {
		t.Fatal("stale snapshot transaction committed")
	}
	var externalCount, importCount int
	if err = db.QueryRow("SELECT count(*) FROM erp_items WHERE id='external'").Scan(&externalCount); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow("SELECT count(*) FROM erp_items WHERE id='import'").Scan(&importCount); err != nil {
		t.Fatal(err)
	}
	if externalCount != 1 || importCount != 0 {
		t.Fatalf("unexpected rows: external=%d import=%d", externalCount, importCount)
	}
}
