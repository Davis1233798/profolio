package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

type commerceOutbox struct{ ID, OrganizationID, Payload string }

// dispatchStationCommerce delivers at least once. The gateway publisher confirms
// messages and its consumer deduplicates by tenant + event id transactionally.
func (a *App) dispatchStationCommerce(ctx context.Context, gateway, secret string, client *http.Client) (int, error) {
	if gateway == "" || secret == "" {
		return 0, nil
	}
	parsed, e := url.Parse(gateway)
	if e != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return 0, errors.New("invalid infrastructure gateway URL")
	}
	rows, e := a.db.QueryContext(ctx, "SELECT id,organization_id,payload FROM outbox_events WHERE event_type='shop.paid' AND status='pending' ORDER BY retry_count,created_at,id LIMIT 25")
	if e != nil {
		return 0, e
	}
	events := []commerceOutbox{}
	for rows.Next() {
		var x commerceOutbox
		if e = rows.Scan(&x.ID, &x.OrganizationID, &x.Payload); e != nil {
			rows.Close()
			return 0, e
		}
		events = append(events, x)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return 0, e
	}
	sent := 0
	for _, event := range events {
		var payload struct {
			OrderID string `json:"orderId"`
		}
		e = json.Unmarshal([]byte(event.Payload), &payload)
		// The infrastructure gateway accepts tenant identifiers up to 64 characters.
		// Preserve deterministic organization isolation without exposing long org IDs.
		tenant := "station_" + digest(event.OrganizationID)[:48]
		if e == nil && (payload.OrderID == "" || len(payload.OrderID) > 128 || len(event.ID) > 128) {
			e = errors.New("invalid commerce event")
		}
		if e == nil {
			body, _ := json.Marshal(map[string]string{"tenant": tenant, "event_id": event.ID, "order_id": payload.OrderID})
			var req *http.Request
			req, e = http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(gateway, "/")+"/commerce/jobs", bytes.NewReader(body))
			if e == nil {
				req.Header.Set("Authorization", "Bearer "+secret)
				req.Header.Set("Content-Type", "application/json")
				var response *http.Response
				response, e = client.Do(req)
				if e == nil {
					_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
					response.Body.Close()
					if response.StatusCode != http.StatusAccepted {
						e = fmt.Errorf("gateway returned HTTP %d", response.StatusCode)
					}
				}
			}
		}
		if e != nil {
			if _, updateErr := a.db.ExecContext(ctx, "UPDATE outbox_events SET retry_count=CASE WHEN retry_count<1000000 THEN retry_count+1 ELSE retry_count END WHERE id=? AND organization_id=? AND status='pending'", event.ID, event.OrganizationID); updateErr != nil {
				return sent, updateErr
			}
			continue
		}
		update, updateErr := a.db.ExecContext(ctx, "UPDATE outbox_events SET status='processed' WHERE id=? AND organization_id=? AND status='pending'", event.ID, event.OrganizationID)
		if updateErr != nil {
			return sent, updateErr
		}
		n, updateErr := update.RowsAffected()
		if updateErr != nil {
			return sent, updateErr
		}
		sent += int(n)
	}
	return sent, nil
}
func (a *App) startStationCommerceDispatcher() {
	gateway, secret := os.Getenv("INFRA_GATEWAY_URL"), os.Getenv("INFRA_GATEWAY_TOKEN")
	if gateway == "" || secret == "" {
		return
	}
	client := &http.Client{Timeout: 4 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			ctx, cancel := context.WithTimeout(context.Background(), 110*time.Second)
			_, e := a.dispatchStationCommerce(ctx, gateway, secret, client)
			cancel()
			if e != nil {
				fmt.Printf("commerce dispatch failed: %v\n", e)
			}
			<-ticker.C
		}
	}()
}
