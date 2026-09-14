package nativevault

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOpenExternalIsAuthenticatedValidatedAndOptIn(t *testing.T) {
	b := &NativeBridge{token: "synthetic"}
	call := func(body, token string) int {
		request := httptest.NewRequest("POST", "http://127.0.0.1/v1/desktop/open-external", strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		b.serveHTTP(response, request)
		return response.Code
	}
	valid := `{"url":"https://login.example.edu/authorize?state=synthetic"}`
	if status := call(valid, "wrong"); status != http.StatusUnauthorized {
		t.Fatal(status)
	}
	if status := call(valid, "synthetic"); status != http.StatusNotImplemented {
		t.Fatal(status)
	}
	opened := ""
	b.AttachOpenExternal(func(url string) error { opened = url; return nil })
	for _, body := range []string{`{"url":"file:///C:/secret"}`, `{"url":"javascript:alert(1)"}`, `{"url":"https://user:pass@example.edu"}`, valid + ` {}`} {
		if status := call(body, "synthetic"); status != http.StatusBadRequest {
			t.Fatal(status)
		}
	}
	if opened != "" {
		t.Fatal("invalid URL reached shell")
	}
	if status := call(valid, "synthetic"); status != http.StatusOK {
		t.Fatal(status)
	}
	if opened != "https://login.example.edu/authorize?state=synthetic" {
		t.Fatal("authorization URL changed")
	}
}
