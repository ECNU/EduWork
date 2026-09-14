package desktoptransport

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

type mediaGrant struct {
	target  url.URL
	expires time.Time
}

// MediaCarrier only redirects same-origin GET/HEAD API reads to a short-lived,
// exact-resource capability. Wails' Windows AssetServer buffers responses;
// the loopback endpoint instead streams through the same official Host pipes.
// Capabilities are not identity credentials and never enter logs or persistence.
type MediaCarrier struct {
	client   *Client
	events   *EventBridge
	listener net.Listener
	server   *http.Server
	mu       sync.Mutex
	grants   map[string]mediaGrant
}

func StartMediaCarrier(client *Client, events ...*EventBridge) (*MediaCarrier, error) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	c := &MediaCarrier{client: client, listener: listener, grants: make(map[string]mediaGrant)}
	if len(events) > 0 {
		c.events = events[0]
	}
	c.server = &http.Server{Handler: http.HandlerFunc(c.serve), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 15 * time.Second, MaxHeaderBytes: 16 * 1024, ErrorLog: log.New(io.Discard, "", 0)}
	go func() { _ = c.server.Serve(listener) }()
	return c, nil
}
func (c *MediaCarrier) Close()         { _ = c.server.Close(); c.mu.Lock(); clear(c.grants); c.mu.Unlock() }
func (c *MediaCarrier) origin() string { return "http://" + c.listener.Addr().String() }
func mediaRead(method string) bool     { return method == http.MethodGet || method == http.MethodHead }
func validMediaOrigin(r *http.Request) bool {
	if origin := r.Header.Get("Origin"); origin != "" {
		return origin == "http://wails.localhost"
	}
	referer, err := url.Parse(r.Referer())
	return err == nil && referer.Scheme == "http" && referer.Host == "wails.localhost"
}
func (c *MediaCarrier) serve(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Host != c.listener.Addr().String() || !validMediaOrigin(r) || r.URL.RawQuery != "" || !strings.HasPrefix(r.URL.Path, "/read/") {
		http.Error(w, "forbidden", 403)
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", "http://wails.localhost")
	w.Header().Set("Vary", "Origin")
	w.Header().Set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, Content-Type, Content-Disposition, ETag, Last-Modified")
	if r.Method == http.MethodOptions {
		if !mediaRead(r.Header.Get("Access-Control-Request-Method")) {
			http.Error(w, "method not allowed", 405)
			return
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD")
		w.Header().Set("Access-Control-Allow-Headers", "Range, If-Range, If-None-Match, If-Modified-Since")
		w.Header().Set("Access-Control-Max-Age", "300")
		w.WriteHeader(204)
		return
	}
	if !mediaRead(r.Method) {
		http.Error(w, "method not allowed", 405)
		return
	}
	c.mu.Lock()
	grant, ok := c.grants[strings.TrimPrefix(r.URL.Path, "/read/")]
	c.mu.Unlock()
	if !ok || time.Now().After(grant.expires) {
		http.Error(w, "read capability expired", 401)
		return
	}
	request := r.Clone(r.Context())
	target := grant.target
	request.URL = &target
	request.Header.Del("Authorization")
	request.Header.Del("Cookie")
	request.Header.Del("Origin")
	request.Header.Del("Referer")
	c.serveFile(w, request)
}

// A paused browser must not pause the official Host's shared response pipe.
// Read one finite Range completely before writing it to the browser. This also
// keeps memory independent of the total file size while other RPCs remain live.
func (c *MediaCarrier) serveFile(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodHead {
		c.client.Handler().ServeHTTP(w, r)
		return
	}
	head := r.Clone(r.Context())
	head.Method = http.MethodHead
	head.URL.Scheme = "dsh-app"
	head.URL.Host = "app"
	head.RequestURI = ""
	metadata, err := c.client.RoundTrip(head)
	if err != nil {
		http.Error(w, "media metadata unavailable", 502)
		return
	}
	metadata.Body.Close()
	length, err := strconv.ParseInt(metadata.Header.Get("Content-Length"), 10, 64)
	if err != nil || length < 0 || (metadata.StatusCode != 200 && metadata.StatusCode != 206) || metadata.Header.Get("Accept-Ranges") != "bytes" {
		c.client.Handler().ServeHTTP(w, r)
		return
	}
	start := int64(0)
	expectedTotal := length
	if metadata.StatusCode == 206 {
		var end int64
		if n, _ := fmt.Sscanf(metadata.Header.Get("Content-Range"), "bytes %d-%d/%d", &start, &end, &expectedTotal); n != 3 || start < 0 || end-start+1 != length || end >= expectedTotal {
			http.Error(w, "invalid media range metadata", 502)
			return
		}
	}
	for key, values := range metadata.Header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	w.WriteHeader(metadata.StatusCode)
	const blockBytes = int64(256 * 1024)
	for remaining := length; remaining > 0; {
		size := min(remaining, blockBytes)
		part := r.Clone(r.Context())
		target := *r.URL
		target.Scheme = "dsh-app"
		target.Host = "app"
		part.URL = &target
		part.RequestURI = ""
		part.Header.Del("If-Range")
		part.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", start, start+size-1))
		response, err := c.client.RoundTrip(part)
		if err != nil {
			panic(http.ErrAbortHandler)
		}
		data, readErr := io.ReadAll(io.LimitReader(response.Body, size+1))
		response.Body.Close()
		var actualStart, actualEnd, total int64
		parsed, _ := fmt.Sscanf(response.Header.Get("Content-Range"), "bytes %d-%d/%d", &actualStart, &actualEnd, &total)
		if readErr != nil || response.StatusCode != 206 || int64(len(data)) != size || parsed != 3 || actualStart != start || actualEnd != start+size-1 || total != expectedTotal {
			panic(http.ErrAbortHandler)
		}
		if _, err := w.Write(data); err != nil {
			return
		}
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		start += size
		remaining -= size
	}
}
func (c *MediaCarrier) Handler() http.Handler {
	assets := c.client.WailsHandler(c.events)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !mediaRead(r.Method) || !strings.HasPrefix(r.URL.Path, "/api/") {
			assets.ServeHTTP(w, r)
			return
		}
		// Register the exact already-authorized local request. The resulting URL
		// cannot be edited to read another path or carry a different query string.
		bytes := make([]byte, 32)
		if _, err := rand.Read(bytes); err != nil {
			http.Error(w, "media transport unavailable", 503)
			return
		}
		id := base64.RawURLEncoding.EncodeToString(bytes)
		now := time.Now()
		c.mu.Lock()
		for key, grant := range c.grants {
			if now.After(grant.expires) {
				delete(c.grants, key)
			}
		}
		if len(c.grants) >= 4096 {
			c.mu.Unlock()
			http.Error(w, "too many media reads", 503)
			return
		}
		c.grants[id] = mediaGrant{target: *r.URL, expires: now.Add(30 * time.Minute)}
		c.mu.Unlock()
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Location", c.origin()+"/read/"+id)
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.WriteHeader(http.StatusTemporaryRedirect)
	})
}
