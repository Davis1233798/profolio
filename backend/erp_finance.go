package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

type journalLine struct {
	AccountCode string `json:"accountCode"`
	AccountName string `json:"accountName"`
	Debit       int64  `json:"debitAmount"`
	Credit      int64  `json:"creditAmount"`
}
type financeRequest struct {
	Action      string        `json:"action"`
	InvoiceID   string        `json:"invoiceId"`
	OrderID     string        `json:"orderId"`
	InvoiceKind string        `json:"invoiceKind"`
	DueDate     string        `json:"dueDate"`
	Amount      int64         `json:"amount"`
	Method      string        `json:"method"`
	EntryDate   string        `json:"entryDate"`
	Description string        `json:"description"`
	Reference   string        `json:"reference"`
	Lines       []journalLine `json:"lines"`
	Key         string        `json:"idempotencyKey"`
}

func (a *App) erpFinance(w http.ResponseWriter, r *http.Request, id *Identity, g *Grant) {
	if r.Method != http.MethodPost {
		fail(w, 405, "Use POST")
		return
	}
	if g.Role == "readonly" || g.Scope != "back" {
		fail(w, 403, "Write-enabled back-office access required")
		return
	}
	var in financeRequest
	if body(r, &in) != nil || len(in.Key) < 8 || len(in.Key) > 128 || len(in.InvoiceID) > 256 || len(in.OrderID) > 256 || (in.Action != "payment" && in.Action != "journal" && in.Action != "invoice") {
		fail(w, 400, "Invalid finance request")
		return
	}
	in.Description = strings.TrimSpace(in.Description)
	in.Reference = strings.TrimSpace(in.Reference)
	if in.Action == "payment" && (in.InvoiceID == "" || in.Amount < 1 || in.Amount > 1000000000000000 || (in.Method != "bank_transfer" && in.Method != "cash")) {
		fail(w, 400, "Enter a valid payment amount and method")
		return
	}
	if in.Action == "invoice" {
		if in.OrderID == "" || (in.InvoiceKind != "payable" && in.InvoiceKind != "receivable") {
			fail(w, 400, "Select an invoice type and order")
			return
		}
		if in.DueDate != "" {
			date, err := time.Parse("2006-01-02", in.DueDate)
			if err != nil || date.Format("2006-01-02") != in.DueDate {
				fail(w, 400, "Enter a valid due date")
				return
			}
		}
	}
	var debit, credit int64
	if in.Action == "journal" {
		date, e := time.Parse("2006-01-02", in.EntryDate)
		if e != nil || date.Format("2006-01-02") != in.EntryDate || len(in.Description) == 0 || len(in.Description) > 500 || len(in.Reference) > 128 || len(in.Lines) < 2 || len(in.Lines) > 100 {
			fail(w, 400, "Enter valid journal details")
			return
		}
		for i := range in.Lines {
			l := &in.Lines[i]
			l.AccountCode = strings.TrimSpace(l.AccountCode)
			l.AccountName = strings.TrimSpace(l.AccountName)
			if l.AccountCode == "" || len(l.AccountCode) > 40 || l.AccountName == "" || len(l.AccountName) > 150 || l.Debit < 0 || l.Credit < 0 || l.Debit > 1000000000000 || l.Credit > 1000000000000 || (l.Debit > 0 && l.Credit > 0) {
				fail(w, 400, "Invalid journal line")
				return
			}
			debit += l.Debit
			credit += l.Credit
		}
		if debit == 0 || debit != credit {
			fail(w, 400, "Journal debits and credits must balance and be nonzero")
			return
		}
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, 503, "Finance unavailable")
		return
	}
	defer tx.Rollback()
	raw, _ := json.Marshal(in)
	hash := digest(id.UserID + "\x00" + string(raw))
	endpoint := "/station/erp/finance/" + in.Action
	var oldHash, oldBody string
	e = tx.QueryRow("SELECT request_hash,response_body FROM idempotency_keys WHERE organization_id=? AND key=? AND endpoint=?", id.OrganizationID, in.Key, endpoint).Scan(&oldHash, &oldBody)
	if e == nil {
		if hash != oldHash {
			fail(w, 409, "Retry key already used")
			return
		}
		var result map[string]any
		if json.Unmarshal([]byte(oldBody), &result) != nil {
			fail(w, 500, "Invalid retry result")
			return
		}
		ok(w, result)
		return
	}
	if !errors.Is(e, sql.ErrNoRows) {
		fail(w, 503, "Cannot read retry state")
		return
	}
	entity := ""
	result := map[string]any{}
	if in.Action == "invoice" {
		var number, partner, status string
		var total int64
		var lineCount, unfinished int
		if in.InvoiceKind == "payable" {
			e = tx.QueryRow("SELECT po_number,supplier_id,status,total_amount FROM erp_purchase_orders WHERE organization_id=? AND id=?", id.OrganizationID, in.OrderID).Scan(&number, &partner, &status, &total)
			if e == nil {
				e = tx.QueryRow("SELECT count(*),COALESCE(sum(CASE WHEN quantity<=0 OR received_quantity<quantity THEN 1 ELSE 0 END),0) FROM erp_purchase_order_lines WHERE organization_id=? AND po_id=?", id.OrganizationID, in.OrderID).Scan(&lineCount, &unfinished)
			}
		} else {
			e = tx.QueryRow("SELECT so_number,customer_id,status,total_amount FROM erp_sales_orders WHERE organization_id=? AND id=?", id.OrganizationID, in.OrderID).Scan(&number, &partner, &status, &total)
			if e == nil {
				e = tx.QueryRow("SELECT count(*),COALESCE(sum(CASE WHEN quantity<=0 OR shipped_quantity<quantity THEN 1 ELSE 0 END),0) FROM erp_sales_order_lines WHERE organization_id=? AND so_id=?", id.OrganizationID, in.OrderID).Scan(&lineCount, &unfinished)
			}
		}
		if errors.Is(e, sql.ErrNoRows) {
			fail(w, 404, "Source order not found")
			return
		}
		if e != nil {
			fail(w, 503, "Cannot read source order")
			return
		}
		if status == "cancelled" || status == "rejected" || lineCount == 0 || unfinished != 0 || total <= 0 || total > 1000000000000000 {
			fail(w, 409, "Order must be fully received or shipped before invoicing")
			return
		}
		prefix, partnerType := "AP-", "supplier"
		if in.InvoiceKind == "receivable" {
			prefix, partnerType = "AR-", "customer"
		}
		invoiceNumber := prefix + number
		var count int
		e = tx.QueryRow("SELECT count(*) FROM erp_invoices WHERE organization_id=? AND invoice_type=? AND invoice_number=?", id.OrganizationID, in.InvoiceKind, invoiceNumber).Scan(&count)
		if e != nil {
			fail(w, 503, "Cannot check invoice")
			return
		}
		if count > 0 {
			fail(w, 409, "An invoice already exists for this order")
			return
		}
		entity = "invoice_" + digest(id.OrganizationID+"\x00"+in.InvoiceKind+"\x00"+in.OrderID)
		var due any = nil
		if in.DueDate != "" {
			due = in.DueDate
		}
		_, e = tx.Exec("INSERT INTO erp_invoices(id,organization_id,invoice_number,invoice_type,partner_type,partner_id,total_amount,due_date,status) VALUES(?,?,?,?,?,?,?,?, 'unpaid')", entity, id.OrganizationID, invoiceNumber, in.InvoiceKind, partnerType, partner, total, due)
		result = map[string]any{"invoiceId": entity, "invoiceNumber": invoiceNumber, "totalAmount": total}
	} else if in.Action == "payment" {
		entity = in.InvoiceID
		var total, paid int64
		var status string
		e = tx.QueryRow("SELECT total_amount,paid_amount,status FROM erp_invoices WHERE organization_id=? AND id=?", id.OrganizationID, entity).Scan(&total, &paid, &status)
		if errors.Is(e, sql.ErrNoRows) {
			fail(w, 404, "Invoice not found")
			return
		}
		if e != nil {
			fail(w, 503, "Cannot read invoice")
			return
		}
		if total < 0 || paid < 0 || paid > total || (status != "unpaid" && status != "partially_paid") || in.Amount > total-paid {
			fail(w, 409, "Payment exceeds balance or invoice is closed")
			return
		}
		newPaid := paid + in.Amount
		next := "partially_paid"
		if newPaid == total {
			next = "paid"
		}
		number := "PAY-" + strings.ToUpper(token()[:12])
		_, e = tx.Exec("UPDATE erp_invoices SET paid_amount=?,status=? WHERE organization_id=? AND id=? AND paid_amount=?", newPaid, next, id.OrganizationID, entity, paid)
		if e == nil {
			_, e = tx.Exec("INSERT INTO erp_payments(id,organization_id,payment_number,invoice_id,amount,payment_method) VALUES(?,?,?,?,?,?)", "payment_"+token(), id.OrganizationID, number, entity, in.Amount, in.Method)
		}
		result = map[string]any{"paymentNumber": number, "paidAmount": newPaid, "unpaidAmount": total - newPaid, "status": next}
	} else {
		var closed int
		e = tx.QueryRow("SELECT count(*) FROM erp_fiscal_periods WHERE organization_id=? AND is_closed=1 AND start_date<=? AND end_date>=?", id.OrganizationID, in.EntryDate, in.EntryDate).Scan(&closed)
		if e != nil {
			fail(w, 503, "Cannot check fiscal period")
			return
		}
		if closed > 0 {
			fail(w, 409, "Cannot post in a closed fiscal period")
			return
		}
		entity = "journal_" + token()
		number := "JE-" + strings.ToUpper(token()[:12])
		_, e = tx.Exec("INSERT INTO erp_journal_entries(id,organization_id,entry_number,entry_date,description,reference_doc,status) VALUES(?,?,?,?,?,?,'posted')", entity, id.OrganizationID, number, in.EntryDate, in.Description, in.Reference)
		for _, l := range in.Lines {
			if e != nil {
				break
			}
			_, e = tx.Exec("INSERT INTO erp_journal_lines(id,organization_id,journal_id,account_code,account_name,debit_amount,credit_amount) VALUES(?,?,?,?,?,?,?)", "journal_line_"+token(), id.OrganizationID, entity, l.AccountCode, l.AccountName, l.Debit, l.Credit)
		}
		result = map[string]any{"entryNumber": number, "totalDebit": debit, "totalCredit": credit}
	}
	if e != nil {
		fail(w, 503, "Cannot save finance transaction")
		return
	}
	encoded, _ := json.Marshal(result)
	_, e = tx.Exec("INSERT INTO idempotency_keys(id,organization_id,key,endpoint,request_hash,response_status,response_body) VALUES(?,?,?,?,?,200,?)", "idem_"+token(), id.OrganizationID, in.Key, endpoint, hash, string(encoded))
	if e == nil {
		_, e = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,after_value) VALUES(?,?,?,?,?,'erp_finance',?,?)", "audit_"+token(), id.OrganizationID, id.UserID, g.Role, "erp."+in.Action, entity, string(encoded))
	}
	if e != nil {
		fail(w, 503, "Cannot record finance transaction")
		return
	}
	if tx.Commit() != nil {
		fail(w, 503, "Cannot commit finance transaction")
		return
	}
	ok(w, result)
}
