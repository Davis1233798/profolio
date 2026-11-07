package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func publicDemoSignIn(a *App, peer, email, password, space string, clientAddresses ...string) *httptest.ResponseRecorder {
	payload, _ := json.Marshal(map[string]string{"site": "mes", "email": email, "password": password})
	r := httptest.NewRequest(http.MethodPost, "http://station.example/api/auth/login", bytes.NewReader(payload))
	r.RemoteAddr = peer
	r.Header.Set("Content-Type", "application/json")
	for _, address := range clientAddresses {
		r.Header.Add("X-Suite-Station-Client-IP", address)
	}
	if space != "" {
		r.AddCookie(&http.Cookie{Name: demoCookie, Value: space})
	}
	w := httptest.NewRecorder()
	a.ServeHTTP(w, r)
	return w
}

func TestPublicDemoInvalidLoginDoesNotProvision(t *testing.T) {
	a := appForTest(t)
	space := token()
	w := publicDemoSignIn(a, "192.0.2.2:1234", "admin@suite.test", "invalid-password", space)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("wrong demo credential returned %d", w.Code)
	}
	if len(w.Result().Cookies()) != 0 {
		t.Error("failed login issued a cookie")
	}
	for _, query := range []string{
		"SELECT count(*) FROM organizations WHERE id=?",
		"SELECT count(*) FROM station_accounts WHERE organization_id=?",
		"SELECT count(*) FROM mes_work_orders WHERE organization_id=?",
	} {
		var rows int
		if err := a.db.QueryRow(query, "org_test_"+space).Scan(&rows); err != nil {
			t.Fatal(err)
		}
		if rows != 0 {
			t.Errorf("failed login created %d records: %s", rows, query)
		}
	}
}

func TestPublicDemoTrustedEdgeDoesNotShareOneLoginBudget(t *testing.T) {
	t.Setenv("SUITE_STATION_TRUSTED_EDGE_HOST", "localhost")
	a := appForTest(t)
	space := token()
	loginFrom := func(client string) int {
		return publicDemoSignIn(a, "127.0.0.1:1234", "viewer@suite.test", testPassword, space, client).Code
	}
	for i := 0; i < 20; i++ {
		if status := loginFrom("192.0.2.2"); status != http.StatusOK {
			t.Fatalf("client A attempt %d returned %d", i+1, status)
		}
	}
	retry := publicDemoSignIn(a, "127.0.0.1:2345", " VIEWER@suite.test ", testPassword, token(), "192.0.2.2")
	if retry.Code != http.StatusTooManyRequests {
		t.Fatalf("exhausted client A returned %d after rotating cookie and email case", retry.Code)
	}
	if status := loginFrom("2001:db8::2"); status != http.StatusOK {
		t.Fatalf("different client behind the same edge returned %d", status)
	}
}

func TestPublicDemoUntrustedPeerCannotRotateClientHeader(t *testing.T) {
	t.Setenv("SUITE_STATION_TRUSTED_EDGE_HOST", "localhost")
	a := appForTest(t)
	space := token()
	for i := 0; i < 20; i++ {
		w := publicDemoSignIn(a, "192.0.2.3:1234", "viewer@suite.test", testPassword, space, "192.0.2.2")
		if w.Code != http.StatusOK {
			t.Fatalf("direct attempt %d returned %d", i+1, w.Code)
		}
	}
	w := publicDemoSignIn(a, "192.0.2.3:5678", "viewer@suite.test", testPassword, token(), "192.0.2.4")
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("spoofed client address returned %d", w.Code)
	}
}

func TestPublicDemoExistingAccountRequiresStoredCredentialAndGrant(t *testing.T) {
	a := appForTest(t)
	space := token()
	const peer = "192.0.2.5:1234"
	const email = "viewer@suite.test"
	const newPassword = "ci-fixture-changed-password"
	signIn := func(password string, expected int) {
		t.Helper()
		w := publicDemoSignIn(a, peer, email, password, space)
		if w.Code != expected {
			t.Fatalf("sign-in returned %d, expected %d", w.Code, expected)
		}
		if expected != http.StatusOK && len(w.Result().Cookies()) != 0 {
			t.Fatal("failed sign-in issued a cookie")
		}
	}
	signIn(testPassword, http.StatusOK)
	hash, err := passwordHash(newPassword, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.db.Exec("UPDATE station_accounts SET password_hash=? WHERE organization_id=? AND email=?", hash, "org_test_"+space, email); err != nil {
		t.Fatal(err)
	}
	signIn(testPassword, http.StatusUnauthorized)
	signIn(newPassword, http.StatusOK)
	if _, err := a.db.Exec("UPDATE station_accounts SET disabled=1 WHERE organization_id=? AND email=?", "org_test_"+space, email); err != nil {
		t.Fatal(err)
	}
	signIn(newPassword, http.StatusUnauthorized)
}
