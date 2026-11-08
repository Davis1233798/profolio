package main

import (
	"strconv"
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

type AuditEntry struct {
	ID          string `json:"id"`
	Timestamp   int64  `json:"timestamp"`
	TimeString  string `json:"timeString"`
	UserID      string `json:"userId"`
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
	Action      string `json:"action"`
	Module      string `json:"module"`
	DeviceID    string `json:"deviceId"`
	IPAddress   string `json:"ipAddress"`
	Status      string `json:"status"`
	Details     string `json:"details"`
}

func ensureAuditTable(db *sql.DB) error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS audit_logs (
		id TEXT PRIMARY KEY,
		timestamp INTEGER NOT NULL,
		user_id TEXT NOT NULL,
		email TEXT NOT NULL,
		display_name TEXT NOT NULL,
		action TEXT NOT NULL,
		module TEXT NOT NULL,
		device_id TEXT NOT NULL,
		ip_address TEXT NOT NULL,
		status TEXT NOT NULL,
		details TEXT NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
	`)
	return err
}

func (a *App) recordAudit(userID, email, name, action, module, status, details string, r *http.Request) {
	hostname, _ := os.Hostname()
	if hostname == "" {
		hostname = "WIN-WORKSTATION-01"
	}
	ip := "127.0.0.1"
	if r != nil {
		ip = r.RemoteAddr
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			ip = strings.Split(xff, ",")[0]
		}
	}

	now := time.Now().UnixMilli()
	id := fmt.Sprintf("AUD-%d-%s", now, token()[:8])

	_, _ = a.db.Exec(`INSERT INTO audit_logs(id, timestamp, user_id, email, display_name, action, module, device_id, ip_address, status, details)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, now, userID, email, name, action, module, hostname, ip, status, details,
	)
}

func (a *App) getRecentAudits(limit int) ([]AuditEntry, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := a.db.Query(`SELECT id, timestamp, user_id, email, display_name, action, module, device_id, ip_address, status, details 
		FROM audit_logs ORDER BY timestamp DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := []AuditEntry{}
	for rows.Next() {
		var e AuditEntry
		if err := rows.Scan(&e.ID, &e.Timestamp, &e.UserID, &e.Email, &e.DisplayName, &e.Action, &e.Module, &e.DeviceID, &e.IPAddress, &e.Status, &e.Details); err != nil {
			return nil, err
		}
		e.TimeString = time.UnixMilli(e.Timestamp).Format("2006-01-02 15:04:05")
		entries = append(entries, e)
	}
	return entries, nil
}


func (a *App) auditLogsAPI(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if q := r.URL.Query().Get("limit"); q != "" {
		if val, err := strconv.Atoi(q); err == nil && val > 0 && val <= 200 {
			limit = val
		}
	}
	logs, err := a.getRecentAudits(limit)
	if err != nil {
		fail(w, 500, "無法讀取稽核日誌: "+err.Error())
		return
	}
	ok(w, map[string]any{
		"logs":  logs,
		"total": len(logs),
	})
}
