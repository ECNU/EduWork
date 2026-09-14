package nativevault

import (
	"encoding/json"
	"net/http"
	"net/url"
)

// AttachOpenExternal provides the new desktop protocol's browser seam.
// Existing callers do not opt in and therefore retain an unavailable endpoint.
func (b *NativeBridge) AttachOpenExternal(open func(string) error) {
	b.extensionsMu.Lock()
	defer b.extensionsMu.Unlock()
	b.openExternal = open
}

func (b *NativeBridge) serveOpenExternal(response http.ResponseWriter, request *http.Request) {
	request.Body = http.MaxBytesReader(response, request.Body, 16384)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	var payload struct {
		URL string `json:"url"`
	}
	if decoder.Decode(&payload) != nil || ensureJSONEnd(decoder) != nil {
		http.Error(response, "invalid external URL request", http.StatusBadRequest)
		return
	}
	parsed, err := url.Parse(payload.URL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" || parsed.User != nil {
		http.Error(response, "external URL must use HTTP or HTTPS", http.StatusBadRequest)
		return
	}
	b.extensionsMu.RLock()
	open := b.openExternal
	b.extensionsMu.RUnlock()
	if open == nil {
		http.Error(response, "external browser unavailable", http.StatusNotImplemented)
		return
	}
	if err := open(payload.URL); err != nil {
		http.Error(response, "external browser failed", http.StatusInternalServerError)
		return
	}
	response.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(response).Encode(map[string]bool{"opened": true})
}
