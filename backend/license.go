package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const MasterLicenseSecret = "BUSINESS_SUITE_MASTER_AUTHORITY_KEY_2026_PRODUCTION_SIGNING_SECRET"

type LicensePayload struct {
	ID        string   `json:"id"`
	Customer  string   `json:"customer"`
	Contact   string   `json:"contact"`
	HWID      string   `json:"hwid"`
	Modules   []string `json:"modules"`
	IssuedAt  int64    `json:"issuedAt"`
	ExpiresAt int64    `json:"expiresAt"`
	Tier      string   `json:"tier"`
}

func (l *LicensePayload) IsExpired() bool {
	return time.Now().Unix() > l.ExpiresAt
}

func (l *LicensePayload) AllowsModule(module string) bool {
	for _, m := range l.Modules {
		if strings.EqualFold(m, module) || m == "all" || m == "*" {
			return true
		}
	}
	return false
}

func VerifyLicense(key string) (*LicensePayload, error) {
	trimmed := strings.TrimSpace(key)
	if !strings.HasPrefix(trimmed, "BSLIC-V1-") {
		return nil, errors.New("金鑰格式錯誤（缺少 BSLIC-V1- 前綴）")
	}
	rest := strings.TrimPrefix(trimmed, "BSLIC-V1-")
	parts := strings.Split(rest, ".")
	if len(parts) != 2 {
		return nil, errors.New("金鑰結構無效（缺少簽章）")
	}
	payloadB64 := parts[0]
	sigHex := parts[1]

	mac := hmac.New(sha256.New, []byte(MasterLicenseSecret))
	mac.Write([]byte(payloadB64))
	expectedSig := mac.Sum(nil)
	expectedHex := hex.EncodeToString(expectedSig)

	if subtle.ConstantTimeCompare([]byte(strings.ToLower(sigHex)), []byte(strings.ToLower(expectedHex))) != 1 {
		return nil, errors.New("金鑰簽章驗證失敗，金鑰可能遭到篡改或無效")
	}

	jsonBytes, err := base64.StdEncoding.DecodeString(payloadB64)
	if err != nil {
		return nil, errors.New("金鑰 Base64 解碼失敗")
	}

	var payload LicensePayload
	if err := json.Unmarshal(jsonBytes, &payload); err != nil {
		return nil, errors.New("金鑰格式無效")
	}

	return &payload, nil
}

func (a *App) resolveCurrentLicense() *LicensePayload {
	if a != nil && a.license != nil {
		return a.license
	}
	// 1. Check environment variable
	if key := os.Getenv("SUITE_LICENSE_KEY"); key != "" {
		if lic, err := VerifyLicense(key); err == nil {
			return lic
		}
	}

	// 2. Check license.dat in APPDATA
	if appData := os.Getenv("APPDATA"); appData != "" {
		licPath := filepath.Join(appData, "Business Suite", "license.dat")
		if data, err := os.ReadFile(licPath); err == nil {
			if lic, err := VerifyLicense(string(data)); err == nil {
				return lic
			}
		}
	}

	// 3. Default enterprise license (1 year from now)
	now := time.Now().Unix()
	return &LicensePayload{
		ID:        "LIC-DEFAULT-ENTERPRISE",
		Customer:  "台灣先進智能製造股份有限公司",
		Contact:   "admin@smart-manufacturing.tw",
		HWID:      "ANY",
		Modules:   []string{"erp", "mes", "crm", "shop", "pos", "dining"},
		IssuedAt:  now - 86400,
		ExpiresAt: now + 365*86400,
		Tier:      "enterprise_unlimited",
	}
}

func (a *App) licenseStatusAPI(w http.ResponseWriter, r *http.Request) {
	lic := a.resolveCurrentLicense()
	now := time.Now().Unix()
	remaining := (lic.ExpiresAt - now) / 86400
	if remaining < 0 {
		remaining = 0
	}
	ok(w, map[string]any{
		"license":            lic,
		"isExpired":          lic.IsExpired(),
		"expiresAtFormatted": time.Unix(lic.ExpiresAt, 0).Format("2006-01-02 15:04:05"),
		"issuedAtFormatted":  time.Unix(lic.IssuedAt, 0).Format("2006-01-02 15:04:05"),
		"remainingDays":      remaining,
	})
}

func (a *App) licenseUpdateAPI(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Key string `json:"key"`
	}
	if body(r, &input) != nil || strings.TrimSpace(input.Key) == "" {
		fail(w, 400, "請提供有效的授權金鑰字串")
		return
	}

	lic, err := VerifyLicense(input.Key)
	if err != nil {
		fail(w, 400, fmt.Sprintf("授權金鑰無效: %v", err))
		return
	}

	a.license = lic
	_ = os.Setenv("SUITE_LICENSE_KEY", input.Key)

	if os.Getenv("SUITE_DESKTOP_SESSION") != "" {
		if appData := os.Getenv("APPDATA"); appData != "" {
			licDir := filepath.Join(appData, "Business Suite")
			_ = os.MkdirAll(licDir, 0700)
			_ = os.WriteFile(filepath.Join(licDir, "license.dat"), []byte(strings.TrimSpace(input.Key)), 0600)
		}
	}

	a.recordAudit("", "", "", "license_update", "system", "success", fmt.Sprintf("已成功更新授權金鑰至 %s (%s)", lic.Customer, lic.Tier), r)

	ok(w, map[string]any{
		"success": true,
		"license": lic,
		"message": "授權金鑰已成功套用更新",
	})
}
