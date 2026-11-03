package main

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode"
)

func TestDemoFixturesUseEnglishText(t *testing.T) {
	b, err := migrations.ReadFile("migrations/fixtures.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures map[string][]map[string]any
	if err = json.Unmarshal(b, &fixtures); err != nil {
		t.Fatal(err)
	}
	for table, rows := range fixtures {
		for _, row := range rows {
			for field, value := range row {
				if text, ok := value.(string); ok && strings.IndexFunc(text, func(r rune) bool { return unicode.Is(unicode.Han, r) }) >= 0 {
					t.Errorf("fixture %s.%s has untranslated text", table, field)
				}
			}
		}
	}
}
