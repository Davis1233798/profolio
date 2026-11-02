package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"fmt"
	"hash"
	"math"
	"sort"
	"strings"
)

type restoreSchemaEntry struct{ kind, name, table, definition string }

func restoreSchema(ctx context.Context, db *sql.DB) ([]restoreSchemaEntry, error) {
	rows, err := db.QueryContext(ctx, `SELECT type, name, tbl_name, COALESCE(sql,'') FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' OR name='sqlite_sequence' ORDER BY type, name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var entries []restoreSchemaEntry
	for rows.Next() {
		var e restoreSchemaEntry
		if err := rows.Scan(&e.kind, &e.name, &e.table, &e.definition); err != nil {
			return nil, err
		}
		if strings.HasPrefix(strings.ToUpper(strings.TrimSpace(e.definition)), "CREATE VIRTUAL TABLE") {
			return nil, fmt.Errorf("virtual tables are not supported")
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

func restoreHashValue(h hash.Hash, value any) error {
	var tag byte
	var data []byte
	var n [8]byte
	switch v := value.(type) {
	case nil:
		tag = 'n'
	case int64:
		tag = 'i'
		binary.BigEndian.PutUint64(n[:], uint64(v))
		data = n[:]
	case float64:
		tag = 'f'
		binary.BigEndian.PutUint64(n[:], math.Float64bits(v))
		data = n[:]
	case string:
		tag = 's'
		data = []byte(v)
	case []byte:
		tag = 'b'
		data = v
	default:
		return fmt.Errorf("unsupported SQLite value type")
	}
	h.Write([]byte{tag})
	var length [8]byte
	binary.BigEndian.PutUint64(length[:], uint64(len(data)))
	h.Write(length[:])
	h.Write(data)
	return nil
}

func restoreTableHashes(ctx context.Context, db *sql.DB, table string) ([][32]byte, error) {
	quoted := `"` + strings.ReplaceAll(table, `"`, `""`) + `"`
	rows, err := db.QueryContext(ctx, "SELECT * FROM "+quoted)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	var hashes [][32]byte
	for rows.Next() {
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return nil, err
		}
		h := sha256.New()
		for _, v := range values {
			if err := restoreHashValue(h, v); err != nil {
				return nil, err
			}
		}
		var sum [32]byte
		copy(sum[:], h.Sum(nil))
		hashes = append(hashes, sum)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.Slice(hashes, func(i, j int) bool { return bytes.Compare(hashes[i][:], hashes[j][:]) < 0 })
	return hashes, nil
}

func compareRestoreDatabases(ctx context.Context, source, candidate *sql.DB) error {
	var a, b int64
	if err := source.QueryRowContext(ctx, "PRAGMA user_version").Scan(&a); err != nil {
		return fmt.Errorf("source version check failed")
	}
	if err := candidate.QueryRowContext(ctx, "PRAGMA user_version").Scan(&b); err != nil || a != b {
		return fmt.Errorf("candidate version differs or cannot be checked")
	}
	left, err := restoreSchema(ctx, source)
	if err != nil {
		return fmt.Errorf("source schema check failed: %w", err)
	}
	right, err := restoreSchema(ctx, candidate)
	if err != nil {
		return fmt.Errorf("candidate schema check failed: %w", err)
	}
	if len(left) != len(right) {
		return fmt.Errorf("candidate schema differs")
	}
	for i, e := range left {
		if e != right[i] {
			return fmt.Errorf("candidate schema differs")
		}
		if e.kind != "table" {
			continue
		}
		x, err := restoreTableHashes(ctx, source, e.name)
		if err != nil {
			return fmt.Errorf("cannot inspect source table %q", e.name)
		}
		y, err := restoreTableHashes(ctx, candidate, e.name)
		if err != nil {
			return fmt.Errorf("cannot inspect candidate table %q", e.name)
		}
		if len(x) != len(y) {
			return fmt.Errorf("candidate table %q differs", e.name)
		}
		for j := range x {
			if x[j] != y[j] {
				return fmt.Errorf("candidate table %q differs", e.name)
			}
		}
	}
	return nil
}
