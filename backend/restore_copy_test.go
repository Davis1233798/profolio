package main

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"
)

func TestRestoreCopyPreservesSourceAndCreatesIndependentCandidate(t *testing.T) {
	a := appForTest(t)
	space := token()
	loginSite(t, a, "admin@suite.test", space, "erp")
	dir := t.TempDir()
	source := filepath.Join(dir, "backup #1 &.sqlite")
	if _, err := a.db.Exec("VACUUM INTO ?", source); err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(dir, "restored #1 &.sqlite")
	if err := restoreBackupToNewFile(context.Background(), source, destination); err != nil {
		t.Fatal(err)
	}
	candidate, err := sql.Open("sqlite", destination)
	if err != nil {
		t.Fatal(err)
	}
	defer candidate.Close()
	org := "org_test_" + space
	var count int
	if err = candidate.QueryRow("SELECT count(*) FROM organizations WHERE id=?", org).Scan(&count); err != nil || count != 1 {
		t.Fatalf("candidate missing organization: %d %v", count, err)
	}
	if _, err = candidate.Exec("DELETE FROM organizations WHERE id=?", org); err != nil {
		t.Fatal(err)
	}
	backup, err := sql.Open("sqlite", source)
	if err != nil {
		t.Fatal(err)
	}
	defer backup.Close()
	if err = backup.QueryRow("SELECT count(*) FROM organizations WHERE id=?", org).Scan(&count); err != nil || count != 1 {
		t.Fatalf("source changed: %d %v", count, err)
	}
}

func TestRestoreCopyRejectsInvalidInputsAndExistingDestination(t *testing.T) {
	a := appForTest(t)
	dir := t.TempDir()
	source, destination := filepath.Join(dir, "source.sqlite"), filepath.Join(dir, "candidate.sqlite")
	if _, err := a.db.Exec("VACUUM INTO ?", source); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(destination, []byte("do not overwrite"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := restoreBackupToNewFile(context.Background(), source, destination); err == nil {
		t.Fatal("existing destination accepted")
	}
	if contents, err := os.ReadFile(destination); err != nil || string(contents) != "do not overwrite" {
		t.Fatal("existing destination changed")
	}
	if err := restoreBackupToNewFile(context.Background(), source, source); err == nil {
		t.Fatal("source overwrite accepted")
	}
	if err := restoreBackupToNewFile(context.Background(), filepath.Join(dir, "missing.sqlite"), filepath.Join(dir, "missing-out.sqlite")); err == nil {
		t.Fatal("missing source accepted")
	}
	invalid := filepath.Join(dir, "invalid.sqlite")
	if err := os.WriteFile(invalid, []byte("not sqlite"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := restoreBackupToNewFile(context.Background(), invalid, filepath.Join(dir, "invalid-out.sqlite")); err == nil {
		t.Fatal("invalid source accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := restoreBackupToNewFile(ctx, source, filepath.Join(dir, "cancelled.sqlite")); err == nil {
		t.Fatal("cancelled restore accepted")
	}
}

func TestRestoreCopyRejectsUnrelatedSQLiteSchema(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "unrelated.sqlite")
	db, err := sql.Open("sqlite", source)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("CREATE TABLE unrelated (id INTEGER)"); err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	if err = restoreBackupToNewFile(context.Background(), source, filepath.Join(dir, "candidate.sqlite")); err == nil {
		t.Fatal("unrelated SQLite schema accepted")
	}
}

func TestRestoreCopyCommandRequiresTwoPaths(t *testing.T) {
	for _, args := range [][]string{nil, {"source"}, {"", "destination"}, {"source", ""}, {"a", "b", "c"}} {
		if err := restoreCopyCommand(context.Background(), args); err == nil {
			t.Fatalf("invalid command accepted: %q", args)
		}
	}
	a := appForTest(t)
	dir := t.TempDir()
	source, destination := filepath.Join(dir, "source.sqlite"), filepath.Join(dir, "copy.sqlite")
	if _, err := a.db.Exec("VACUUM INTO ?", source); err != nil {
		t.Fatal(err)
	}
	if err := restoreCopyCommand(context.Background(), []string{source, destination}); err != nil {
		t.Fatal(err)
	}
	if err := restoreCopyCommand(context.Background(), []string{source, destination}); err == nil {
		t.Fatal("command overwrote existing destination")
	}
}

// Comparison must detect logical differences even when both files pass quick_check.
func TestRestoreCandidateContentComparison(t *testing.T) {
	ctx := context.Background()
	create := func() *sql.DB {
		db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "comparison.sqlite"))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { db.Close() })
		for _, q := range []string{
			"CREATE TABLE organizations (id TEXT PRIMARY KEY)",
			"CREATE TABLE records (value, payload BLOB)",
			"INSERT INTO organizations VALUES ('org')",
			"INSERT INTO records VALUES ('same', x'00ff'), ('same', x'00ff'), (NULL, x'01')",
			"PRAGMA user_version=7",
		} {
			if _, err := db.Exec(q); err != nil {
				t.Fatal(err)
			}
		}
		return db
	}
	source := create()
	t.Run("equal", func(t *testing.T) {
		if err := compareRestoreDatabases(ctx, source, create()); err != nil {
			t.Fatal(err)
		}
	})
	for _, tc := range []struct{ name, change string }{
		{"value", "UPDATE records SET value='changed' WHERE value='same'"},
		{"duplicate", "DELETE FROM records WHERE rowid=(SELECT MIN(rowid) FROM records WHERE value='same')"},
		{"blob", "UPDATE records SET payload=x'00fe' WHERE value='same'"},
		{"schema", "CREATE TABLE extra (value TEXT)"},
		{"version", "PRAGMA user_version=8"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			other := create()
			if _, err := other.Exec(tc.change); err != nil {
				t.Fatal(err)
			}
			if err := compareRestoreDatabases(ctx, source, other); err == nil {
				t.Fatal("different databases accepted")
			}
		})
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if err := compareRestoreDatabases(cancelled, source, create()); err == nil {
		t.Fatal("cancelled comparison accepted")
	}
}

func TestRestoreComparisonIncludesSQLiteLikeUserTable(t *testing.T) {
	source, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "source.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	candidate, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "candidate.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer candidate.Close()
	for _, db := range []*sql.DB{source, candidate} {
		if _, err := db.Exec("CREATE TABLE organizations (id TEXT)"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := source.Exec("CREATE TABLE sqliteXrecords (value TEXT)"); err != nil {
		t.Fatal(err)
	}
	if _, err := source.Exec("INSERT INTO sqliteXrecords VALUES ('important')"); err != nil {
		t.Fatal(err)
	}
	if err := compareRestoreDatabases(context.Background(), source, candidate); err == nil {
		t.Fatal("missing user table accepted")
	}
}
