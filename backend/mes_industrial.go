package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

func (a *App) mesIndustrial(w http.ResponseWriter, r *http.Request, id *Identity, g *Grant) {
	if r.Method != http.MethodGet {
		fail(w, 405, "Use GET")
		return
	}
	if g.Scope != "back" {
		fail(w, 403, "Back-office access required")
		return
	}
	gateway, secret := os.Getenv("INFRA_GATEWAY_URL"), os.Getenv("INFRA_GATEWAY_TOKEN")
	u, e := url.Parse(gateway)
	if gateway == "" || secret == "" || e != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		fail(w, 503, "Equipment data service is not configured")
		return
	}
	tenant := "station_" + digest(id.OrganizationID)[:48]
	req, e := http.NewRequestWithContext(r.Context(), http.MethodGet, strings.TrimRight(gateway, "/")+"/industrial/"+tenant, nil)
	if e != nil {
		fail(w, 503, "Equipment data unavailable")
		return
	}
	req.Header.Set("Authorization", "Bearer "+secret)
	response, e := (&http.Client{Timeout: 3 * time.Second}).Do(req)
	if e != nil {
		fail(w, 503, "Equipment data unavailable")
		return
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		fail(w, 503, "Equipment data unavailable")
		return
	}
	var value struct {
		Measurements json.RawMessage `json:"measurements"`
	}
	limited := io.LimitReader(response.Body, 1024*1024+1)
	data, e := io.ReadAll(limited)
	if e != nil || len(data) > 1024*1024 || json.Unmarshal(data, &value) != nil || len(value.Measurements) == 0 || value.Measurements[0] != '[' {
		fail(w, 502, "Invalid equipment data")
		return
	}
	ok(w, map[string]any{"measurements": value.Measurements})
}
