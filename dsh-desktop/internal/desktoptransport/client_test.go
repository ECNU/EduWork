package desktoptransport

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestWireFragmentsAndLimits(t *testing.T) {
	var buffer bytes.Buffer
	input := []byte{0, 255, 13, 10, 7}
	if err := writeFrame(&buffer, frameData, 42, input); err != nil {
		t.Fatal(err)
	}
	got, err := readFrame(&buffer)
	if err != nil {
		t.Fatal(err)
	}
	if got.id != 42 || got.kind != frameData || !bytes.Equal(got.payload, input) {
		t.Fatal("frame mismatch")
	}
	if err := writeFrame(&buffer, frameData, 42, make([]byte, chunkBytes+1)); err == nil {
		t.Fatal("oversize accepted")
	}
	if _, err := readFrame(bytes.NewReader([]byte{1, 2, 3})); err == nil {
		t.Fatal("truncated frame accepted")
	}
}

func fixtureClient(t *testing.T) *Client {
	t.Helper()
	adapter := os.Getenv("DSH_HOST_ADAPTER")
	if adapter == "" {
		t.Skip("set DSH_HOST_ADAPTER to a prepared shared Host directory for real child-process protocol tests")
	}
	root, err := filepath.Abs(filepath.Join("..", "..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	profile := t.TempDir()
	hostDir := filepath.Join(profile, "node_modules", "@deepseek-ai", "dsh-desktop-host", "lib")
	if err := os.MkdirAll(hostDir, 0700); err != nil {
		t.Fatal(err)
	}
	fixture, err := os.ReadFile(filepath.Join(root, "dsh-host", "test", "fixture-host.mjs"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(hostDir, "index.js"), fixture, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(hostDir, "..", "package.json"), []byte(`{"type":"module"}`), 0600); err != nil {
		t.Fatal(err)
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	log, err := os.Create(filepath.Join(profile, "bridge.log"))
	if err != nil {
		t.Fatal(err)
	}
	c, err := Start(ctx, Config{Node: node, Bridge: filepath.Join(root, "dsh-host", "bridge.mjs"), Adapter: filepath.Join(adapter, "host-process.mjs"), Profile: profile, Bootstrap: map[string]string{"test": "synthetic"}, Env: append(os.Environ(), "DSH_TEST_HOST_WIRE="+filepath.Join(adapter, "desktop-host", "lib", "wire.js")), Log: log})
	if err != nil {
		cancel()
		log.Close()
		data, _ := os.ReadFile(log.Name())
		t.Fatalf("start: %v\n%s", err, data)
	}
	t.Cleanup(func() {
		ctx, stop := context.WithTimeout(context.Background(), 25*time.Second)
		defer stop()
		_ = c.Close(ctx)
		cancel()
		log.Close()
	})
	if c.Ready.ProtocolVersion != 3 {
		t.Fatal("wrong official protocol")
	}
	return c
}

func get(t *testing.T, c *Client, path string) *http.Response {
	t.Helper()
	request, _ := http.NewRequest("GET", "dsh-app://app"+path, nil)
	response, err := c.RoundTrip(request)
	if err != nil {
		t.Fatal(err)
	}
	return response
}
func read(t *testing.T, response *http.Response) []byte {
	t.Helper()
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestOfficialCarrierUploadRangeBootstrapAndHandler(t *testing.T) {
	c := fixtureClient(t)
	if string(read(t, get(t, c, "/bootstrap"))) != `{"present":true}` {
		t.Fatal("stdin bootstrap lost")
	}
	payload := bytes.Repeat([]byte{0, 255, 8, 19, 23, 10}, 1500000)
	request, _ := http.NewRequest("POST", "dsh-app://app/echo", bytes.NewReader(payload))
	response, err := c.RoundTrip(request)
	if err != nil {
		t.Fatal(err)
	}
	if actual := read(t, response); !bytes.Equal(actual, payload) {
		t.Fatalf("streamed upload/response mismatch: got %d want %d", len(actual), len(payload))
	}
	rangeRequest := httptest.NewRequest("GET", "http://wails.localhost/range", nil)
	rangeRequest.Header.Set("Range", "bytes=3-7")
	recorder := httptest.NewRecorder()
	c.Handler().ServeHTTP(recorder, rangeRequest)
	if recorder.Code != 206 || recorder.Body.String() != "34567" || recorder.Header().Get("Content-Range") != "bytes 3-7/16" {
		t.Fatalf("Range not preserved: %v", recorder)
	}
	bad, _ := http.NewRequest("GET", "https://outside.example/", nil)
	if _, err := c.RoundTrip(bad); err == nil {
		t.Fatal("external origin accepted")
	}
}

func TestResponseCancellationReachesOfficialHostAndKeepsCarrierUsable(t *testing.T) {
	c := fixtureClient(t)
	response := get(t, c, "/stream")
	first := make([]byte, 4096)
	if _, err := io.ReadFull(response.Body, first); err != nil {
		t.Fatal(err)
	}
	if err := response.Body.Close(); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		var status struct{ Canceled, Active int }
		if err := json.Unmarshal(read(t, get(t, c, "/status")), &status); err != nil {
			t.Fatal(err)
		}
		if status.Canceled >= 1 && status.Active == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("cancel did not reach official Host")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if string(read(t, get(t, c, "/"))) != "ok" {
		t.Fatal("carrier did not recover after cancel")
	}
}

func TestUploadCancellationClosesReaderAndReleasesStream(t *testing.T) {
	c := fixtureClient(t)
	ctx, cancel := context.WithCancel(context.Background())
	reader, writer := io.Pipe()
	request, _ := http.NewRequestWithContext(ctx, "POST", "dsh-app://app/slow-upload", reader)
	result := make(chan error, 1)
	go func() { _, err := c.RoundTrip(request); result <- err }()
	written := make(chan error, 1)
	go func() { _, err := writer.Write(bytes.Repeat([]byte{7}, chunkBytes)); written <- err }()
	select {
	case err := <-written:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("upload did not flow")
	}
	cancel()
	select {
	case err := <-result:
		if err == nil {
			t.Fatal("canceled request succeeded")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("cancel blocked")
	}
	if _, err := writer.Write([]byte{1}); err == nil {
		t.Fatal("request reader was not closed")
	}
	writer.Close()
	if string(read(t, get(t, c, "/"))) != "ok" {
		t.Fatal("carrier failed after upload cancel")
	}
}

func TestUnexpectedHostExitFailsRequestAndStopsBridge(t *testing.T) {
	c := fixtureClient(t)
	request, _ := http.NewRequest("GET", "dsh-app://app/crash", nil)
	if _, err := c.RoundTrip(request); err == nil {
		t.Fatal("Host crash was hidden")
	}
	select {
	case <-c.exited:
	case <-time.After(5 * time.Second):
		t.Fatal("bridge remained alive after Host crash")
	}
	if !strings.Contains(c.failure().Error(), "desktop") {
		t.Fatal("missing transport failure")
	}
}

func TestWailsNativeEventPullAndCancel(t *testing.T) {
	c := fixtureClient(t)
	events := NewEventBridge(c)
	defer events.Close()
	id, err := events.Open(events.BeginDocument(), "fixture", map[string]string{"topic": "synthetic"})
	if err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 3; index++ {
		next, err := events.Next(id)
		if err != nil || next.Done || string(next.Value) != `{"message":"中文事件"}` {
			t.Fatalf("native event mismatch: %s %v", next.Value, err)
		}
	}
	events.Cancel(id)
	next, err := events.Next(id)
	if err != nil || !next.Done {
		t.Fatal("canceled event stream did not finish")
	}
	if string(read(t, get(t, c, "/"))) != "ok" {
		t.Fatal("carrier broken after native event cancel")
	}
}

func TestWailsReloadReleasesOrphanedDocumentSubscriptions(t *testing.T) {
	c := fixtureClient(t)
	events := NewEventBridge(c)
	defer events.Close()
	oldDocument := events.BeginDocument()
	id, err := events.Open(oldDocument, "fixture", nil)
	if err != nil {
		t.Fatal(err)
	}
	if next, err := events.Next(id); err != nil || next.Done {
		t.Fatal("old subscription did not start", err)
	}
	// Model a destroyed browser document: its generator cannot execute finally,
	// so no caller ever asks for the subsequent event frame.
	time.Sleep(30 * time.Millisecond)
	blockedContext, blockedCancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	blockedRequest, _ := http.NewRequestWithContext(blockedContext, "GET", "dsh-app://app/status", nil)
	if response, err := c.RoundTrip(blockedRequest); err == nil {
		response.Body.Close()
		blockedCancel()
		t.Fatal("fixture did not reproduce orphaned-stream backpressure")
	}
	blockedCancel()
	page := httptest.NewRecorder()
	c.WailsHandler(events).ServeHTTP(page, httptest.NewRequest("GET", "http://wails.localhost/", nil))
	if page.Code != 200 {
		t.Fatal("new page could not recover before loading its scripts")
	}
	events.mu.Lock()
	newDocument := events.document
	events.mu.Unlock()
	if newDocument == oldDocument {
		t.Fatal("document generation did not advance")
	}
	if _, err := events.Open(oldDocument, "fixture", nil); err == nil {
		t.Fatal("stale document could reopen a subscription")
	}
	rpcContext, rpcCancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer rpcCancel()
	request, _ := http.NewRequestWithContext(rpcContext, "GET", "dsh-app://app/status", nil)
	response, err := c.RoundTrip(request)
	if err != nil {
		t.Fatal("reload did not release RPC", err)
	}
	read(t, response)
	newID, err := events.Open(newDocument, "fixture", nil)
	if err != nil {
		t.Fatal(err)
	}
	next, err := events.Next(newID)
	if err != nil || next.Done || string(next.Value) != `{"message":"中文事件"}` {
		t.Fatal("new document did not receive events", err)
	}
}

func TestWailsBufferedAssetsRejectOversizedResponseBeforeAllocation(t *testing.T) {
	c := fixtureClient(t)
	request := httptest.NewRequest("GET", "http://wails.localhost/oversized", nil)
	recorder := httptest.NewRecorder()
	c.WailsHandler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusRequestEntityTooLarge || recorder.Body.Len() > 1024 {
		t.Fatal("Wails media buffer was not bounded")
	}
	if string(read(t, get(t, c, "/"))) != "ok" {
		t.Fatal("carrier broken after oversized asset cancel")
	}
}

func TestMediaCarrierStreamsWithExactShortLivedReadGrants(t *testing.T) {
	c := fixtureClient(t)
	carrier, err := StartMediaCarrier(c)
	if err != nil {
		t.Fatal(err)
	}
	defer carrier.Close()
	if !strings.HasPrefix(carrier.origin(), "http://127.0.0.1:") {
		t.Fatal("carrier is not loopback")
	}
	client := &http.Client{Timeout: 5 * time.Second}
	grant := func(path string) string {
		recorder := httptest.NewRecorder()
		carrier.Handler().ServeHTTP(recorder, httptest.NewRequest("GET", "http://wails.localhost"+path, nil))
		if recorder.Code != 307 {
			t.Fatal("read was not redirected")
		}
		return recorder.Header().Get("Location")
	}
	rangeURL := grant("/api/range")
	call := func(target, origin, method, byteRange string) *http.Response {
		t.Helper()
		request, _ := http.NewRequest(method, target, nil)
		request.Header.Set("Origin", origin)
		if byteRange != "" {
			request.Header.Set("Range", byteRange)
		}
		response, err := client.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		return response
	}
	bad := call(rangeURL, "http://malicious.example", "GET", "")
	bad.Body.Close()
	if bad.StatusCode != 403 {
		t.Fatal("cross-origin request accepted")
	}
	bad = call(carrier.origin()+"/read/invalid", "http://wails.localhost", "GET", "")
	bad.Body.Close()
	if bad.StatusCode != 401 {
		t.Fatal("missing capability accepted")
	}
	bad = call(rangeURL, "http://wails.localhost", "POST", "")
	bad.Body.Close()
	if bad.StatusCode != 405 {
		t.Fatal("mutation method accepted")
	}
	bad = call(rangeURL+"?path=/another", "http://wails.localhost", "GET", "")
	bad.Body.Close()
	if bad.StatusCode != 403 {
		t.Fatal("read grant could change its target")
	}
	response := call(rangeURL, "http://wails.localhost", "GET", "bytes=3-7")
	if response.StatusCode != 206 || string(read(t, response)) != "34567" || response.Header.Get("Content-Range") != "bytes 3-7/16" {
		t.Fatal("Range changed in loopback carrier")
	}
	// Native media elements use a Referer rather than an Origin header.
	mediaRequest, _ := http.NewRequest("GET", rangeURL, nil)
	mediaRequest.Header.Set("Referer", "http://wails.localhost/")
	mediaRequest.Header.Set("Range", "bytes=3-7")
	response, err = client.Do(mediaRequest)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 206 || string(read(t, response)) != "34567" {
		t.Fatal("native media referer rejected")
	}
	bad = call(rangeURL, "", "GET", "")
	bad.Body.Close()
	if bad.StatusCode != 403 {
		t.Fatal("origin-free request accepted")
	}
	carrier.mu.Lock()
	id := strings.TrimPrefix(rangeURL, carrier.origin()+"/read/")
	expired := carrier.grants[id]
	expired.expires = time.Now().Add(-time.Second)
	carrier.grants[id] = expired
	carrier.mu.Unlock()
	bad = call(rangeURL, "http://wails.localhost", "GET", "")
	bad.Body.Close()
	if bad.StatusCode != 401 {
		t.Fatal("expired capability accepted")
	}
	response = call(grant("/api/stream"), "http://wails.localhost", "GET", "")
	first := make([]byte, 4096)
	if _, err := io.ReadFull(response.Body, first); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if bytes.Count(first, []byte{42}) != len(first) {
		t.Fatal("streamed bytes changed")
	}
	response = call(grant("/api/large"), "http://wails.localhost", "GET", "")
	if _, err := io.ReadFull(response.Body, first); err != nil {
		t.Fatal(err)
	}
	// Fill the network buffers, then leave this read paused while another RPC
	// uses the same official Host and Go framing pipe.
	time.Sleep(250 * time.Millisecond)
	rpcContext, rpcCancel := context.WithTimeout(context.Background(), 2*time.Second)
	rpcRequest, _ := http.NewRequestWithContext(rpcContext, "GET", "dsh-app://app/status", nil)
	rpcResponse, rpcErr := c.RoundTrip(rpcRequest)
	if rpcErr != nil {
		response.Body.Close()
		rpcCancel()
		t.Fatal("paused media blocked unrelated RPC", rpcErr)
	}
	read(t, rpcResponse)
	rpcCancel()
	response.Body.Close()
	// A changed total length must abort instead of combining two file versions.
	resizedRequest, _ := http.NewRequest("GET", grant("/api/resized"), nil)
	resizedRequest.Header.Set("Origin", "http://wails.localhost")
	resized, resizeErr := client.Do(resizedRequest)
	if resizeErr == nil {
		_, resizeErr = io.ReadAll(resized.Body)
		resized.Body.Close()
	}
	if resizeErr == nil {
		t.Fatal("changed range total was accepted")
	}
	carrier.Close()
	if _, err := client.Get(rangeURL); err == nil {
		t.Fatal("media listener survived close")
	}
}
