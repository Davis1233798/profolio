package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

func runLegacyImportCommand(ctx context.Context, database, backupDir string, input io.Reader, output io.Writer) error {
	if strings.TrimSpace(database) == "" || strings.TrimSpace(backupDir) == "" {
		return fmt.Errorf("database and backup directory are required")
	}
	info, err := os.Lstat(backupDir)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("backup directory is unavailable")
	}
	raw, err := io.ReadAll(io.LimitReader(input, 5000001))
	if err != nil || len(raw) > 5000000 {
		return fmt.Errorf("invalid import request")
	}
	var request struct {
		OrganizationID string               `json:"organizationId"`
		UserID         string               `json:"userId"`
		Session        string               `json:"session"`
		Confirm        string               `json:"confirmOrganizationId"`
		Key            string               `json:"idempotencyKey"`
		Entries        []legacyMappingEntry `json:"entries"`
		Backup         legacyBackupPreview  `json:"backup"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&request); err != nil {
		return fmt.Errorf("invalid import request")
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF || !strings.HasPrefix(request.OrganizationID, "org_") || request.Confirm != request.OrganizationID || request.UserID == "" || len(request.Session) != 64 || len(request.Key) < 8 || len(request.Key) > 128 || len(request.Entries) > 500 {
		return fmt.Errorf("invalid import request")
	}
	name := "legacy-before-" + token() + ".sqlite"
	id := &Identity{OrganizationID: request.OrganizationID, UserID: request.UserID}
	count, err := offlineImportLegacy(ctx, database, filepath.Join(backupDir, name), id, request.Session, request.Backup, request.Entries, request.Key)
	if err != nil {
		return fmt.Errorf("import failed; check the backup directory and operator permissions")
	}
	if err = json.NewEncoder(output).Encode(map[string]any{"rows": count, "snapshot": name}); err != nil {
		return fmt.Errorf("import committed but result could not be written; inspect audit records before retrying")
	}
	return nil
}
