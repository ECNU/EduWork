package desktoptransport

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
)

const maxEventBytes = 8 * 1024 * 1024

type nativeEventStream struct {
	response *http.Response
	reader   *bufio.Reader
	cancel   context.CancelFunc
	reading  bool
}
type NativeEvent struct {
	Done  bool            `json:"done"`
	Value json.RawMessage `json:"value,omitempty"`
}

// EventBridge adapts the official NDJSON event endpoint to Wails pull bindings.
// Wails 2's Windows AssetServer buffers HTTP responses until EOF and therefore
// cannot carry an indefinite Fetch stream. Product RPC and Host remain unchanged.
type EventBridge struct {
	client   *Client
	mu       sync.Mutex
	next     uint64
	document uint64
	streams  map[uint64]*nativeEventStream
	opening  map[uint64]context.CancelFunc
}

func NewEventBridge(client *Client) *EventBridge {
	return &EventBridge{client: client, next: 1, streams: make(map[uint64]*nativeEventStream), opening: make(map[uint64]context.CancelFunc)}
}

// AttachEventClient is used by the candidate's asynchronous startup, before
// making its document handler available. No event can race with attachment.
func AttachEventClient(b *EventBridge, client *Client) {
	b.mu.Lock()
	b.client = client
	b.mu.Unlock()
}

// A page reload destroys JavaScript without awaiting generator finally blocks.
// Release the previous document's subscriptions before its successor starts any
// RPCs, including opens whose Host response has not arrived yet.
func (b *EventBridge) BeginDocument() uint64 {
	b.mu.Lock()
	b.document++
	document := b.document
	streams, opening := b.streams, b.opening
	b.streams = make(map[uint64]*nativeEventStream)
	b.opening = make(map[uint64]context.CancelFunc)
	b.mu.Unlock()
	for _, cancel := range opening {
		cancel()
	}
	for _, stream := range streams {
		stream.cancel()
		_ = stream.response.Body.Close()
	}
	return document
}

func (b *EventBridge) Open(document uint64, endpoint string, payload any) (uint64, error) {
	body, err := json.Marshal(map[string]any{"endpoint": endpoint, "payload": payload})
	if err != nil {
		return 0, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	b.mu.Lock()
	if document == 0 || document != b.document {
		b.mu.Unlock()
		cancel()
		return 0, errors.New("desktop event document is no longer active")
	}
	id := b.next
	b.next++
	b.opening[id] = cancel
	client := b.client
	b.mu.Unlock()
	defer func() { b.mu.Lock(); delete(b.opening, id); b.mu.Unlock() }()
	if client == nil {
		cancel()
		return 0, errors.New("desktop Host is not ready")
	}
	request, err := http.NewRequestWithContext(ctx, "POST", "dsh-app://app/.dsh/remote-stream", bytes.NewReader(body))
	if err != nil {
		cancel()
		return 0, err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := client.RoundTrip(request)
	if err != nil {
		cancel()
		return 0, err
	}
	if response.StatusCode != 200 {
		response.Body.Close()
		cancel()
		return 0, errors.New("official desktop event endpoint failed")
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if document != b.document {
		response.Body.Close()
		cancel()
		return 0, errors.New("desktop event document was replaced")
	}
	b.streams[id] = &nativeEventStream{response: response, reader: bufio.NewReaderSize(response.Body, chunkBytes), cancel: cancel}
	return id, nil
}
func (b *EventBridge) Next(id uint64) (NativeEvent, error) {
	b.mu.Lock()
	stream := b.streams[id]
	if stream == nil {
		b.mu.Unlock()
		return NativeEvent{Done: true}, nil
	}
	if stream.reading {
		b.mu.Unlock()
		return NativeEvent{}, errors.New("desktop event stream already has a pending read")
	}
	stream.reading = true
	b.mu.Unlock()
	defer func() { b.mu.Lock(); stream.reading = false; b.mu.Unlock() }()
	for {
		var line []byte
		for {
			part, err := stream.reader.ReadSlice('\n')
			line = append(line, part...)
			if len(line) > maxEventBytes {
				b.Cancel(id)
				return NativeEvent{}, errors.New("desktop event exceeds supported record size")
			}
			if err == bufio.ErrBufferFull {
				continue
			}
			if err != nil && err != io.EOF {
				b.Cancel(id)
				return NativeEvent{}, err
			}
			if len(line) == 0 && err == io.EOF {
				b.Cancel(id)
				return NativeEvent{Done: true}, nil
			}
			break
		}
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}
		if !json.Valid(line) {
			b.Cancel(id)
			return NativeEvent{}, errors.New("invalid official desktop event JSON")
		}
		return NativeEvent{Value: json.RawMessage(line)}, nil
	}
}
func (b *EventBridge) Cancel(id uint64) {
	b.mu.Lock()
	stream := b.streams[id]
	delete(b.streams, id)
	b.mu.Unlock()
	if stream != nil {
		stream.cancel()
		_ = stream.response.Body.Close()
	}
}
func (b *EventBridge) Close() {
	b.BeginDocument()
}

const wailsEventsScript = `<script>
(()=>{
const ready=(async()=>{
  let bridge;
  for(let attempt=0;attempt<300;attempt++){
    bridge=globalThis.go?.desktoptransport?.EventBridge;
    if(bridge)break;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  if(!bridge)throw new Error('Wails event bridge is unavailable');
  return {bridge,document:__EDUWORK_DOCUMENT_GENERATION__};
})();
ready.catch(()=>{});
globalThis.__DSH_TRANSPORT__={ownsHost:true,async *openStream(endpoint,payload,signal){
  const {bridge,document}=await ready;
  if(signal?.aborted)throw signal.reason;
  const id=await bridge.Open(document,endpoint,payload);
  const cancel=()=>{void bridge.Cancel(id).catch(()=>{})};
  signal?.addEventListener('abort',cancel,{once:true});
  try{
    if(signal?.aborted){cancel();throw signal.reason}
    for(;;){const next=await bridge.Next(id);if(next.done)return;yield next.value}
  }finally{signal?.removeEventListener('abort',cancel);await bridge.Cancel(id).catch(()=>{})}
}};
})();
</script>`

// WailsHandler handles finite assets/RPCs and installs the native event carrier.
// Its hard cap prevents Wails' own bytes.Buffer from accumulating huge media.
func (c *Client) WailsHandler(events ...*EventBridge) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		document := uint64(0)
		if r.Method == http.MethodGet && (r.URL.Path == "/" || r.URL.Path == "") && len(events) > 0 && events[0] != nil {
			// Release old document subscriptions before fetching even the index:
			// an orphaned stream may otherwise block that shared pipe too.
			document = events[0].BeginDocument()
		}
		if r.URL.Path == "/.dsh/remote-stream" {
			http.Error(w, "Use the native desktop event carrier", http.StatusNotImplemented)
			return
		}
		request := r.Clone(r.Context())
		url := *r.URL
		url.Scheme = "dsh-app"
		url.Host = "app"
		url.User = nil
		if url.Path == "" {
			url.Path = "/"
		}
		request.URL = &url
		request.RequestURI = ""
		response, err := c.RoundTrip(request)
		if err != nil {
			http.Error(w, "Desktop Host unavailable", http.StatusBadGateway)
			return
		}
		defer response.Body.Close()
		const maxBytes = 32 * 1024 * 1024
		if response.ContentLength > maxBytes {
			http.Error(w, "This Wails preview requires a smaller byte range; large downloads need the streaming carrier", http.StatusRequestEntityTooLarge)
			return
		}
		// The framework buffers anyway; bound that allocation before committing status.
		body, err := io.ReadAll(io.LimitReader(response.Body, maxBytes+1))
		if err != nil {
			http.Error(w, "Desktop response interrupted", http.StatusBadGateway)
			return
		}
		if len(body) > maxBytes {
			http.Error(w, "Wails response exceeds the buffered preview limit", http.StatusRequestEntityTooLarge)
			return
		}
		if (r.URL.Path == "/" || r.URL.Path == "") && response.StatusCode == http.StatusOK {
			script := strings.ReplaceAll(wailsEventsScript, "__EDUWORK_DOCUMENT_GENERATION__", strconv.FormatUint(document, 10))
			body = bytes.Replace(body, []byte("</head>"), []byte(script+"</head>"), 1)
			response.Header.Del("Content-Length")
		}
		for name, values := range response.Header {
			for _, value := range values {
				w.Header().Add(name, value)
			}
		}
		w.WriteHeader(response.StatusCode)
		_, _ = w.Write(body)
	})
}
