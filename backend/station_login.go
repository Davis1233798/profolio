package main

import (
	"context"
	"crypto/subtle"
	"net"
	"net/http"
	"net/netip"
	"os"
	"time"
)

const stationClientIPHeader = "X-Suite-Station-Client-IP"

func stationLoginAddress(r *http.Request) string {
	peer, err := netip.ParseAddrPort(r.RemoteAddr)
	if err != nil {
		return "unknown"
	}
	peerIP := peer.Addr().WithZone("").Unmap()
	host := os.Getenv("SUITE_STATION_TRUSTED_EDGE_HOST")
	headers := r.Header.Values(stationClientIPHeader)
	if host == "" || len(headers) != 1 {
		return peerIP.String()
	}
	client, err := netip.ParseAddr(headers[0])
	if err != nil || client.Zone() != "" {
		return peerIP.String()
	}
	ctx, cancel := context.WithTimeout(r.Context(), 500*time.Millisecond)
	defer cancel()
	addresses, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil {
		return peerIP.String()
	}
	for _, address := range addresses {
		if address.Unmap() == peerIP {
			return client.Unmap().String()
		}
	}
	return peerIP.String()
}

func (a *App) stationLoginAllowed(ctx context.Context, key string, limit int, now int64) (bool, error) {
	var attempts int
	err := a.db.QueryRowContext(ctx, `
		INSERT INTO station_login_limits(key,attempts,reset_at) VALUES(?,1,?)
		ON CONFLICT(key) DO UPDATE SET
			attempts=CASE WHEN reset_at<=? THEN 1 ELSE min(attempts+1,?) END,
			reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END
		RETURNING attempts
	`, digest(key), now+15*60*1000, now, limit+1, now).Scan(&attempts)
	return attempts <= limit, err
}

func publishedDemoCredentials(email, password string) bool {
	if subtle.ConstantTimeCompare([]byte(password), []byte(testPassword)) != 1 {
		return false
	}
	for _, account := range demoPeople {
		if account.Email == email {
			return true
		}
	}
	return false
}
