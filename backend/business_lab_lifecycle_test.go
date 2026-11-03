package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestBusinessLabUsesIsolatedDatabaseAndCleansUp(t *testing.T) {
	root := t.TempDir()
	manager := newBusinessLabManager(root, 1)
	lab, err := manager.acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if lab.app == nil || lab.app.db == nil {
		t.Fatal("isolated app was not initialized")
	}
	if _, err = manager.acquire(context.Background()); err == nil {
		t.Fatal("concurrent run exceeded limit")
	}
	path := lab.directory
	if filepath.Dir(path) != root {
		t.Fatalf("directory outside root: %q", path)
	}
	if err = lab.close(); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("temporary run directory remains: %v", err)
	}
	next, err := manager.acquire(context.Background())
	if err != nil {
		t.Fatalf("slot not released: %v", err)
	}
	if err = next.close(); err != nil {
		t.Fatal(err)
	}
}

func TestBusinessLabCanceledPreparationDoesNotLeakSlot(t *testing.T) {
	manager := newBusinessLabManager(t.TempDir(), 1)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := manager.acquire(ctx); err == nil {
		t.Fatal("canceled run accepted")
	}
	lab, err := manager.acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err = lab.close(); err != nil {
		t.Fatal(err)
	}
}
