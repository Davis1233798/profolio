package main

import (
	"net/http"
	"strings"
)

func (a *App) posBarcode(w http.ResponseWriter, r *http.Request, id *Identity) {
	if r.Method != http.MethodGet {
		fail(w, 405, "Use GET")
		return
	}
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	if code == "" || len(code) > 200 {
		fail(w, 400, "Enter a valid barcode")
		return
	}
	rows, e := queryMaps(a.db, "SELECT id,name,barcode,price,stock_quantity,is_active FROM pos_catalog_items WHERE organization_id=? AND barcode=? AND is_active=1 LIMIT 2", id.OrganizationID, code)
	if e != nil {
		fail(w, 503, "Cannot search products")
		return
	}
	if len(rows) == 0 {
		fail(w, 404, "Barcode not found")
		return
	}
	if len(rows) > 1 {
		fail(w, 409, "Barcode is ambiguous")
		return
	}
	ok(w, rows[0])
}
