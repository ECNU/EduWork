package nativevault

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

type coreTestStore map[string]string

func (s coreTestStore) Resolve(ref string) (string, bool, error) {
	value, ok := s[ref]
	return value, ok, nil
}
func (s coreTestStore) Set(ref, value string) error { s[ref] = value; return nil }
func (s coreTestStore) Unset(ref string) error      { delete(s, ref); return nil }
func (s coreTestStore) Source() string              { return "synthetic-memory" }

func TestPublicNativeBridgeHasNoInstitutionHandlers(t *testing.T) {
	b, err := StartNative("synthetic-core-token", coreTestStore{})
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	b.AttachExtension("check", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	call := func(path, auth, body string) int {
		t.Helper()
		r, err := http.NewRequest(http.MethodPost, b.URL+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		r.Header.Set("Authorization", auth)
		response, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		_, _ = io.Copy(io.Discard, response.Body)
		return response.StatusCode
	}
	for _, path := range []string{"/v1/enterprise/status", "/v1/update/status", "/v1/diagnostics/export"} {
		if got := call(path, "Bearer synthetic-core-token", `{"ref":"TEST"}`); got != 404 {
			t.Fatalf("%s: %d", path, got)
		}
	}
	if got := call("/v1/extensions/check", "", `{}`); got != 401 {
		t.Fatalf("unauthenticated extension: %d", got)
	}
	if got := call("/v1/extensions/check", "Bearer synthetic-core-token", `{}`); got != 204 {
		t.Fatalf("extension: %d", got)
	}
	if got := call("/v1/credentials/set", "Bearer synthetic-core-token", `{"ref":"TEST","value":"synthetic-value"}`); got != 204 {
		t.Fatalf("set: %d", got)
	}
	if got := call("/v1/credentials/describe", "Bearer synthetic-core-token", `{"ref":"TEST"}`); got != 200 {
		t.Fatalf("describe: %d", got)
	}
}
