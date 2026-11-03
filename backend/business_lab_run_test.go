package main

import (
	"context"
	"errors"
	"os"
	"testing"
)

func TestRunBusinessLabMESAndShop(t *testing.T) {
	for _, site := range []string{"mes", "shop"} {
		t.Run(site, func(t *testing.T) {
			root := t.TempDir()
			manager := newBusinessLabManager(root, 1)
			result, err := runBusinessLab(context.Background(), manager, site, 8)
			if err != nil {
				t.Fatalf("run business lab: %v", err)
			}
			if result.Site != site || result.Attempted != 8 || result.Succeeded != 1 || result.Conflicts != 7 {
				t.Fatalf("unexpected %s concurrency summary: %+v", site, result)
			}
			// A successful race must have committed at least one real business row,
			// while the contested MES quantity / single shop unit is fully consumed.
			if result.BusinessRows < 1 || result.Remaining != 0 {
				t.Fatalf("business result not reconciled: %+v", result)
			}
			entries, err := os.ReadDir(root)
			if err != nil {
				t.Fatal(err)
			}
			if len(entries) != 0 {
				t.Fatalf("run left temporary database artifacts under %s: %v", root, entries)
			}
		})
	}
}

func TestRunBusinessLabRejectsInvalidInputs(t *testing.T) {
	for _, tc := range []struct {
		name       string
		site       string
		contenders int
	}{
		{name: "unsupported site", site: "crm", contenders: 8},
		{name: "zero contenders", site: "mes", contenders: 0},
		{name: "negative contenders", site: "shop", contenders: -1},
		{name: "over documented maximum", site: "shop", contenders: 33},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			manager := newBusinessLabManager(root, 1)
			if _, err := runBusinessLab(context.Background(), manager, tc.site, tc.contenders); err == nil {
				t.Fatalf("accepted invalid site/count: site=%q contenders=%d", tc.site, tc.contenders)
			}
			entries, err := os.ReadDir(root)
			if err != nil {
				t.Fatal(err)
			}
			if len(entries) != 0 {
				t.Fatalf("invalid request created temporary artifacts: %v", entries)
			}
		})
	}
}

func TestRunBusinessLabCanceledContextCleansUp(t *testing.T) {
	root := t.TempDir()
	manager := newBusinessLabManager(root, 1)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := runBusinessLab(ctx, manager, "mes", 8); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled run error=%v, want context.Canceled", err)
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("canceled run left temporary artifacts: %v", entries)
	}
	// A canceled preparation must not retain the single-run capacity slot.
	probe, err := manager.acquire(context.Background())
	if err != nil {
		t.Fatalf("manager capacity leaked after canceled run: %v", err)
	}
	if err := probe.close(); err != nil {
		t.Fatal(err)
	}
}

func TestRunBusinessLabRejectsWhenCapacityIsFull(t *testing.T) {
	root := t.TempDir()
	manager := newBusinessLabManager(root, 1)
	occupied, err := manager.acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = runBusinessLab(context.Background(), manager, "mes", 8); err == nil {
		t.Fatal("run accepted while the manager capacity was occupied")
	}
	if err = occupied.close(); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("capacity rejection or release left temporary artifacts: %v", entries)
	}
}
