package main

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestBackupDatabase(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "source.sqlite")
	target := filepath.Join(dir, "snapshot.sqlite")
	db, err := sql.Open("sqlite", source)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err = db.Exec("PRAGMA journal_mode=WAL; CREATE TABLE records(value TEXT); INSERT INTO records VALUES('before')"); err != nil {
		t.Fatal(err)
	}
	if err = backupDatabase(source, target); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("INSERT INTO records VALUES('after')"); err != nil {
		t.Fatal(err)
	}
	snapshot, err := sql.Open("sqlite", target)
	if err != nil {
		t.Fatal(err)
	}
	defer snapshot.Close()
	var count int
	if err = snapshot.QueryRow("SELECT count(*) FROM records").Scan(&count); err != nil || count != 1 {
		t.Fatalf("snapshot rows %d: %v", count, err)
	}
	if err = backupDatabase(source, target); err == nil {
		t.Fatal("existing snapshot was overwritten")
	}
	if err = backupDatabase(filepath.Join(dir, "missing.sqlite"), filepath.Join(dir, "missing-backup.sqlite")); err == nil {
		t.Fatal("missing source was created")
	}
}
