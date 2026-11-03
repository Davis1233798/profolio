package main

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofrs/flock"
)

// openStationDatabase owns the maintenance lock and database as one resource.
func openStationDatabase(path string) (*sql.DB, func() error, error) {
	release, err := acquireMaintenanceLock(path)
	if err != nil {
		return nil, nil, err
	}
	db, err := openDB(path)
	if err != nil {
		return nil, nil, errors.Join(err, release())
	}
	closeStation := func() error {
		return errors.Join(db.Close(), release())
	}
	return db, closeStation, nil
}

// acquireMaintenanceLock coordinates only processes using this protocol and
// this canonical path. It does not lock out arbitrary SQLite clients.
func acquireMaintenanceLock(path string) (func() error, error) {
	if strings.TrimSpace(path) == "" || path == ":memory:" || strings.HasPrefix(strings.ToLower(path), "file:") {
		return nil, fmt.Errorf("a regular database path is required")
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("invalid database path")
	}
	dir, err := filepath.EvalSymlinks(filepath.Dir(absolute))
	if err != nil {
		return nil, fmt.Errorf("database directory unavailable")
	}
	database := filepath.Join(dir, filepath.Base(absolute))
	info, err := os.Lstat(database)
	if err == nil && !info.Mode().IsRegular() {
		return nil, fmt.Errorf("database must be a regular file")
	}
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("cannot inspect database path")
	}
	lock := flock.New(database + ".maintenance.lock")
	locked, err := lock.TryLock()
	if err != nil {
		return nil, fmt.Errorf("cannot acquire database maintenance lock: %w", err)
	}
	if !locked {
		return nil, fmt.Errorf("database is already in use by a cooperating process")
	}
	return lock.Unlock, nil
}
