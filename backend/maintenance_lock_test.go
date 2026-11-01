package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestMaintenanceLockChild(t *testing.T) {
	path := os.Getenv("SUITE_TEST_MAINTENANCE_DB")
	if path == "" {
		return
	}
	release, err := acquireMaintenanceLock(path)
	if err != nil {
		os.Exit(23)
	}
	if err = release(); err != nil {
		os.Exit(24)
	}
}

func TestMaintenanceLockCrossProcessAndRelease(t *testing.T) {
	path := filepath.Join(t.TempDir(), "station.sqlite")
	release, err := acquireMaintenanceLock(path)
	if err != nil {
		t.Fatal(err)
	}
	child := func() error {
		cmd := exec.Command(os.Args[0], "-test.run=^TestMaintenanceLockChild$")
		cmd.Env = append(os.Environ(), "SUITE_TEST_MAINTENANCE_DB="+path)
		return cmd.Run()
	}
	if err = child(); err == nil {
		release()
		t.Fatal("another process acquired the database maintenance lock")
	} else if exit, ok := err.(*exec.ExitError); !ok || exit.ExitCode() != 23 {
		release()
		t.Fatalf("child failed unexpectedly: %v", err)
	}
	if _, err = os.Stat(path); !os.IsNotExist(err) {
		release()
		t.Fatal("failed lock attempt created or modified the database")
	}
	if err = release(); err != nil {
		t.Fatal(err)
	}
	if err = child(); err != nil {
		t.Fatalf("lock unavailable after release: %v", err)
	}
}

func TestMaintenanceLockRejectsInvalidIdentityAndSeparatesDatabases(t *testing.T) {
	for _, invalid := range []string{"", ":memory:", "file:test.db?mode=memory"} {
		if release, err := acquireMaintenanceLock(invalid); err == nil {
			release()
			t.Fatalf("invalid database identity accepted: %q", invalid)
		}
	}
	dir := t.TempDir()
	first, err := acquireMaintenanceLock(filepath.Join(dir, "one.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer first()
	second, err := acquireMaintenanceLock(filepath.Join(dir, "two.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer second()
}
