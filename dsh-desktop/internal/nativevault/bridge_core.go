package nativevault

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const maxRequestBytes = maxSecretBytes + 1024

// NativeBridge is the institution-independent desktop credential and OS seam.
// It is loopback-only and receives its authentication secret over child stdin.
// Public exports include this core; legacy institution handlers stay separate.
type NativeBridge struct {
	URL          string
	token        string
	store        Store
	listener     net.Listener
	server       *http.Server
	fallback     func(http.ResponseWriter, *http.Request) bool
	closeOnce    sync.Once
	closeErr     error
	extensionsMu sync.RWMutex
	extensions   map[string]http.Handler
	openExternal func(string) error
}

// StartNative exposes only credentials, registered local extensions, and open-external.
func StartNative(token string, store Store) (*NativeBridge, error) {
	return startNative(token, store, nil)
}

// AttachExtension registers a local native adapter. The bridge performs its
// usual authentication before dispatch; no business endpoint or secret is
// made available to browser code by this generic registration mechanism.
func (b *NativeBridge) AttachExtension(name string, handler http.Handler) {
	b.extensionsMu.Lock()
	defer b.extensionsMu.Unlock()
	if b.extensions == nil {
		b.extensions = make(map[string]http.Handler)
	}
	b.extensions["/v1/extensions/"+name] = handler
}

type credentialRequest struct {
	Ref   string `json:"ref"`
	Value string `json:"value,omitempty"`
}

type credentialResponse struct {
	Configured bool   `json:"configured"`
	Writable   bool   `json:"writable,omitempty"`
	Source     string `json:"source,omitempty"`
	Value      string `json:"value,omitempty"`
}

func startNative(token string, store Store, fallback func(http.ResponseWriter, *http.Request) bool) (*NativeBridge, error) {
	if strings.TrimSpace(token) == "" {
		return nil, errors.New("native bridge credential is empty")
	}
	if store == nil {
		return nil, errors.New("native bridge store is nil")
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("listen for native vault bridge: %w", err)
	}
	bridge := &NativeBridge{
		URL:      "http://" + listener.Addr().String(),
		token:    token,
		store:    store,
		fallback: fallback,
		listener: listener,
	}
	bridge.server = &http.Server{
		Handler:           http.HandlerFunc(bridge.serveHTTP),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       15 * time.Second,
		MaxHeaderBytes:    16 * 1024,
	}
	go func() { _ = bridge.server.Serve(listener) }()
	return bridge, nil
}

func (b *NativeBridge) serveHTTP(response http.ResponseWriter, request *http.Request) {
	response.Header().Set("Cache-Control", "no-store")
	if !bearerMatches(request.Header.Get("Authorization"), b.token) {
		http.Error(response, "unauthorized", http.StatusUnauthorized)
		return
	}
	if request.Method != http.MethodPost {
		response.Header().Set("Allow", http.MethodPost)
		http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if request.URL.Path == "/v1/desktop/open-external" {
		b.serveOpenExternal(response, request)
		return
	}
	if strings.HasPrefix(request.URL.Path, "/v1/extensions/") {
		b.extensionsMu.RLock()
		handler := b.extensions[request.URL.Path]
		b.extensionsMu.RUnlock()
		if handler == nil {
			http.NotFound(response, request)
		} else {
			handler.ServeHTTP(response, request)
		}
		return
	}
	if b.fallback != nil && b.fallback(response, request) {
		return
	}
	b.serveCredential(response, request)
}

func (b *NativeBridge) serveCredential(response http.ResponseWriter, request *http.Request) {
	request.Body = http.MaxBytesReader(response, request.Body, maxRequestBytes)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	var payload credentialRequest
	if err := decoder.Decode(&payload); err != nil {
		http.Error(response, "invalid credential request", http.StatusBadRequest)
		return
	}
	if err := ensureJSONEnd(decoder); err != nil || validateRef(payload.Ref) != nil {
		http.Error(response, "invalid credential request", http.StatusBadRequest)
		return
	}

	switch request.URL.Path {
	case "/v1/credentials/resolve":
		value, configured, err := b.store.Resolve(payload.Ref)
		if err != nil {
			b.internalError(response)
			return
		}
		result := credentialResponse{Configured: configured}
		if configured {
			result.Source = b.store.Source()
			result.Value = value
		}
		writeJSON(response, result)
	case "/v1/credentials/describe":
		_, configured, err := b.store.Resolve(payload.Ref)
		if err != nil {
			b.internalError(response)
			return
		}
		result := credentialResponse{Configured: configured, Writable: true}
		if configured {
			result.Source = b.store.Source()
		}
		writeJSON(response, result)
	case "/v1/credentials/set":
		if err := validateValue(payload.Value); err != nil {
			http.Error(response, "invalid credential value", http.StatusBadRequest)
			return
		}
		if err := b.store.Set(payload.Ref, payload.Value); err != nil {
			b.internalError(response)
			return
		}
		response.WriteHeader(http.StatusNoContent)
	case "/v1/credentials/unset":
		if err := b.store.Unset(payload.Ref); err != nil {
			b.internalError(response)
			return
		}
		response.WriteHeader(http.StatusNoContent)
	default:
		http.NotFound(response, request)
	}
}

func (b *NativeBridge) internalError(response http.ResponseWriter) {
	// Never echo native error details: they can contain target names or other
	// operating-system facts and are not actionable in the browser.
	http.Error(response, "native credential operation failed", http.StatusInternalServerError)
}

func (b *NativeBridge) UnauthenticatedStatus(ctx context.Context) (int, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, b.URL+"/v1/credentials/describe", strings.NewReader(`{"ref":"PROBE"}`))
	if err != nil {
		return 0, err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := (&http.Client{Timeout: 2 * time.Second}).Do(request)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	return response.StatusCode, nil
}

func (b *NativeBridge) Close() error {
	b.closeOnce.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		b.closeErr = b.server.Shutdown(ctx)
		if closeErr := b.listener.Close(); b.closeErr == nil && closeErr != nil && !errors.Is(closeErr, net.ErrClosed) {
			b.closeErr = closeErr
		}
	})
	return b.closeErr
}

func bearerMatches(header, expected string) bool {
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return false
	}
	actual := strings.TrimPrefix(header, prefix)
	if len(actual) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(actual), []byte(expected)) == 1
}

func ensureJSONEnd(decoder *json.Decoder) error {
	var extra any
	err := decoder.Decode(&extra)
	if errors.Is(err, io.EOF) {
		return nil
	}
	if err == nil {
		return errors.New("multiple JSON values")
	}
	return err
}

func writeJSON(response http.ResponseWriter, value any) {
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(response).Encode(value)
}
