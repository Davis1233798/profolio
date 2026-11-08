package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func generateTestLicenseKey(customer string, modules []string, days int64) string {
	now := time.Now().Unix()
	payload := LicensePayload{
		ID:        "LIC-TEST-001",
		Customer:  customer,
		Contact:   "tester@example.com",
		HWID:      "ANY",
		Modules:   modules,
		IssuedAt:  now,
		ExpiresAt: now + days*86400,
		Tier:      "enterprise_test",
	}
	b, _ := json.Marshal(payload)
	payloadB64 := base64.StdEncoding.EncodeToString(b)
	mac := hmac.New(sha256.New, []byte(MasterLicenseSecret))
	mac.Write([]byte(payloadB64))
	sig := hex.EncodeToString(mac.Sum(nil))
	return "BSLIC-V1-" + payloadB64 + "." + sig
}

func TestLicenseVerification(t *testing.T) {
	// 1. Valid Active License
	key := generateTestLicenseKey("測試股份有限公司", []string{"mes", "erp"}, 30)
	lic, err := VerifyLicense(key)
	if err != nil {
		t.Fatalf("Expected valid license, got error: %v", err)
	}
	if lic.Customer != "測試股份有限公司" {
		t.Errorf("Customer mismatch: got %s", lic.Customer)
	}
	if !lic.AllowsModule("mes") || !lic.AllowsModule("erp") {
		t.Errorf("Should allow mes and erp")
	}
	if lic.AllowsModule("crm") {
		t.Errorf("Should not allow crm")
	}
	if lic.IsExpired() {
		t.Errorf("License should not be expired")
	}

	// 2. Expired License
	expiredKey := generateTestLicenseKey("過期公司", []string{"all"}, -1)
	expLic, err := VerifyLicense(expiredKey)
	if err != nil {
		t.Fatalf("Expected expired key to parse correctly, got error: %v", err)
	}
	if !expLic.IsExpired() {
		t.Errorf("Expected license to be expired")
	}

	// 3. Tampered Key
	tampered := key[:len(key)-4] + "ffff"
	if _, err := VerifyLicense(tampered); err == nil {
		t.Errorf("Expected verification to fail for tampered key")
	}
}

func TestSSOLoginAndAuditFlow(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "sso_test.sqlite")
	db, err := openDB(dbPath)
	if err != nil {
		t.Fatalf("Failed to open test database: %v", err)
	}
	defer db.Close()

	app := &App{db: db, assets: "."}

	// 1. Valid SSO Login
	body := bytes.NewBufferString(`{"email":"admin@suite.test","password":"SuiteDemo!2026","space":"0000000000000000000000000000000000000000000000000000000000000001"}`)
	req := httptest.NewRequest("POST", "/api/auth/sso-login", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	app.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("SSO Login failed with status %d: %s", rec.Code, rec.Body.String())
	}

	cookies := rec.Result().Cookies()
	var ssoCookie *http.Cookie
	for _, c := range cookies {
		if c.Name == "suite_session_sso" {
			ssoCookie = c
			break
		}
	}
	if ssoCookie == nil {
		t.Fatalf("suite_session_sso cookie was not set")
	}

	// 2. Verify Audit Log was recorded
	audits, err := app.getRecentAudits(10)
	if err != nil {
		t.Fatalf("Failed to fetch audits: %v", err)
	}
	if len(audits) == 0 {
		t.Fatalf("Expected audit logs to be populated")
	}
	found := false
	for _, a := range audits {
		if a.Action == "sso_login" && a.Status == "success" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("Did not find successful sso_login audit entry")
	}

	// 3. Check Audit Logs API
	auditReq := httptest.NewRequest("GET", "/api/audit/logs?limit=5", nil)
	auditRec := httptest.NewRecorder()
	app.ServeHTTP(auditRec, auditReq)
	if auditRec.Code != http.StatusOK {
		t.Errorf("GET /api/audit/logs failed: status %d", auditRec.Code)
	}

	// 4. Invalid Login Audit
	badBody := bytes.NewBufferString(`{"email":"admin@suite.test","password":"WrongPassword123"}`)
	badReq := httptest.NewRequest("POST", "/api/auth/sso-login", badBody)
	badReq.Header.Set("Content-Type", "application/json")
	badRec := httptest.NewRecorder()
	app.ServeHTTP(badRec, badReq)
	if badRec.Code != http.StatusUnauthorized {
		t.Errorf("Expected 401 for wrong password, got %d", badRec.Code)
	}

	// 5. Test License Status API
	statusReq := httptest.NewRequest("GET", "/api/license/status", nil)
	statusRec := httptest.NewRecorder()
	app.ServeHTTP(statusRec, statusReq)
	if statusRec.Code != http.StatusOK {
		t.Errorf("GET /api/license/status failed: status %d", statusRec.Code)
	}

	// 6. Test License Update API
	newKey := generateTestLicenseKey("新客戶科技", []string{"mes"}, 180)
	updateBody := bytes.NewBufferString(`{"key":"` + newKey + `"}`)
	updateReq := httptest.NewRequest("POST", "/api/license/update", updateBody)
	updateReq.Header.Set("Content-Type", "application/json")
	updateRec := httptest.NewRecorder()
	app.ServeHTTP(updateRec, updateReq)
	if updateRec.Code != http.StatusOK {
		t.Errorf("POST /api/license/update failed: status %d", updateRec.Code)
	}

	// 7. Test Module Restriction
	// Calling erp endpoint should now be rejected because app.license only allows "mes"
	erpReq := httptest.NewRequest("GET", "/api/stations/erp/data?view=back", nil)
	erpReq.AddCookie(ssoCookie)
	erpRec := httptest.NewRecorder()
	app.ServeHTTP(erpRec, erpReq)
	if erpRec.Code != http.StatusForbidden {
		t.Errorf("Expected 403 Forbidden for unlicensed module, got status %d", erpRec.Code)
	}
	_ = os.Unsetenv("SUITE_LICENSE_KEY")
}
