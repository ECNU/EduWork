// Package desktoptransport adapts net/http to the official socketless DSH Host.
// It owns a Node bridge because Windows os/exec cannot expose Node's extra IPC fds.
package desktoptransport

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
)

type Config struct {
	Node, Bridge, Adapter, Profile string
	// Bootstrap is delivered once over stdin. Never put credentials in argv or Env.
	Bootstrap          any
	AllowLinkedProfile bool
	Env                []string
	Log                io.Writer
}

type Ready struct {
	BridgeProtocolVersion int    `json:"bridgeProtocolVersion"`
	ProtocolVersion       int    `json:"protocolVersion"`
	DSHVersion            string `json:"dshVersion"`
}

type responseResult struct {
	response *http.Response
	err      error
}
type pending struct {
	header  chan responseResult
	credit  chan struct{}
	done    chan struct{}
	reader  *io.PipeReader
	writer  *io.PipeWriter
	upload  io.ReadCloser
	started bool
	hasBody bool
	request *http.Request
}

type Client struct {
	command     *exec.Cmd
	stdin       io.WriteCloser
	mu          sync.Mutex
	beginMu     sync.Mutex
	writeMu     sync.Mutex
	pending     map[uint32]*pending
	nextID      uint64
	ready       chan Ready
	done        chan struct{}
	exited      chan struct{}
	err         error
	waitErr     error
	closing     bool
	once        sync.Once
	containment func()
	Ready       Ready
}

// Start waits for the complete official Host composition. ctx owns the lifetime.
func Start(ctx context.Context, config Config) (*Client, error) {
	for _, path := range []string{config.Node, config.Bridge, config.Adapter, config.Profile} {
		if !filepath.IsAbs(path) {
			return nil, errors.New("desktop transport paths must be absolute")
		}
	}
	bootstrap, err := json.Marshal(map[string]any{"bridgeProtocolVersion": 1, "bootstrap": config.Bootstrap, "allowLinkedProfile": config.AllowLinkedProfile})
	if err != nil {
		return nil, errors.New("invalid desktop bootstrap")
	}
	command := exec.Command(config.Node, config.Bridge, "--adapter", config.Adapter, "--project", config.Profile)
	command.Dir = config.Profile
	command.Env = config.Env
	if command.Env == nil {
		command.Env = os.Environ()
	}
	command.Stderr = config.Log
	if command.Stderr == nil {
		command.Stderr = io.Discard
	}
	configureProcess(command)
	stdin, err := command.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		stdin.Close()
		return nil, err
	}
	if err := command.Start(); err != nil {
		stdin.Close()
		stdout.Close()
		return nil, err
	}
	containment, err := containProcess(command)
	if err != nil {
		command.Process.Kill()
		command.Wait()
		return nil, fmt.Errorf("contain desktop bridge: %w", err)
	}
	c := &Client{command: command, stdin: stdin, pending: make(map[uint32]*pending), nextID: 1, ready: make(chan Ready, 1), done: make(chan struct{}), exited: make(chan struct{}), containment: containment}
	go c.readResponses(stdout)
	go func() {
		err := command.Wait()
		c.mu.Lock()
		c.waitErr = err
		closing := c.closing
		c.mu.Unlock()
		if !closing {
			c.fail(fmt.Errorf("desktop bridge exited: %v", err))
		} else {
			c.fail(io.EOF)
		}
		containment()
		close(c.exited)
	}()
	if err := c.write(frameInit, 0, bootstrap); err != nil {
		c.fail(err)
	}
	select {
	case facts := <-c.ready:
		c.Ready = facts
	case <-c.done:
		return nil, c.failure()
	case <-ctx.Done():
		c.forceStop()
		return nil, ctx.Err()
	}
	go func() {
		select {
		case <-ctx.Done():
			c.forceStop()
		case <-c.exited:
		}
	}()
	return c, nil
}

func (c *Client) failure() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.err == nil {
		return errors.New("desktop bridge unavailable")
	}
	return c.err
}
func (c *Client) write(kind byte, id uint32, bytes []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	select {
	case <-c.done:
		return c.failure()
	default:
	}
	return writeFrame(c.stdin, kind, id, bytes)
}

func (c *Client) fail(err error) {
	c.once.Do(func() {
		c.mu.Lock()
		c.err = err
		ids := make([]uint32, 0, len(c.pending))
		for id := range c.pending {
			ids = append(ids, id)
		}
		closing := c.closing
		c.mu.Unlock()
		close(c.done)
		for _, id := range ids {
			c.finish(id, err)
		}
		if !closing {
			c.forceStop()
		}
	})
}

func (c *Client) forceStop() { c.containment(); _ = c.command.Process.Kill(); _ = c.stdin.Close() }

func (c *Client) finish(id uint32, err error) {
	c.mu.Lock()
	p := c.pending[id]
	if p != nil {
		delete(c.pending, id)
		close(p.done)
	}
	c.mu.Unlock()
	if p == nil {
		return
	}
	if err != nil {
		select {
		case p.header <- responseResult{err: err}:
		default:
		}
	}
	_ = p.writer.CloseWithError(err)
	if p.upload != nil {
		_ = p.upload.Close()
	}
}

func (c *Client) cancel(id uint32, err error) {
	c.mu.Lock()
	_, exists := c.pending[id]
	c.mu.Unlock()
	if !exists {
		return
	}
	c.finish(id, err) // Releases a blocked response-pipe read before sending cancel.
	if writeErr := c.write(frameCancel, id, nil); writeErr != nil {
		c.fail(writeErr)
	}
}

func (c *Client) readResponses(reader io.Reader) {
	for {
		frame, err := readFrame(reader)
		if err != nil {
			c.fail(fmt.Errorf("read desktop response pipe: %w", err))
			return
		}
		if err := c.accept(frame); err != nil {
			c.fail(err)
			return
		}
	}
}

func (c *Client) accept(f frame) error {
	if f.id == 0 {
		switch f.kind {
		case frameInit:
			var ready Ready
			if json.Unmarshal(f.payload, &ready) != nil || ready.BridgeProtocolVersion != 1 || ready.ProtocolVersion != 3 || ready.DSHVersion == "" {
				return errors.New("unsupported desktop Host ready protocol")
			}
			select {
			case c.ready <- ready:
				return nil
			default:
				return errors.New("duplicate desktop ready")
			}
		case frameShutdown:
			var detail struct {
				Message string `json:"message"`
			}
			_ = json.Unmarshal(f.payload, &detail)
			return fmt.Errorf("desktop Host failed: %s", detail.Message)
		case frameStopped:
			return nil
		default:
			return errors.New("unknown desktop lifecycle frame")
		}
	}
	c.mu.Lock()
	p := c.pending[f.id]
	future := uint64(f.id) >= c.nextID
	c.mu.Unlock()
	if p == nil {
		if future {
			return errors.New("desktop Host responded to unknown stream")
		}
		return nil
	}
	switch f.kind {
	case frameCredit:
		if len(f.payload) != 0 || p.upload == nil {
			return errors.New("invalid desktop upload credit")
		}
		select {
		case p.credit <- struct{}{}:
			return nil
		default:
			return errors.New("duplicate desktop upload credit")
		}
	case frameStart:
		var metadata struct {
			Status  int         `json:"status"`
			Headers [][2]string `json:"headers"`
			HasBody bool        `json:"hasBody"`
		}
		if p.started || json.Unmarshal(f.payload, &metadata) != nil || metadata.Status < 200 || metadata.Status > 599 {
			return errors.New("invalid desktop response start")
		}
		p.started = true
		p.hasBody = metadata.HasBody
		header := make(http.Header)
		for _, pair := range metadata.Headers {
			header.Add(pair[0], pair[1])
		}
		body := io.ReadCloser(http.NoBody)
		if metadata.HasBody {
			body = &responseBody{ReadCloser: p.reader, cancel: func() { c.cancel(f.id, context.Canceled) }}
		}
		length := int64(-1)
		if !metadata.HasBody {
			length = 0
		} else if value := header.Get("Content-Length"); value != "" {
			if n, err := strconv.ParseInt(value, 10, 64); err == nil {
				length = n
			}
		}
		select {
		case p.header <- responseResult{response: &http.Response{StatusCode: metadata.Status, Status: fmt.Sprintf("%d %s", metadata.Status, http.StatusText(metadata.Status)), Header: header, Body: body, ContentLength: length, Request: p.request}}:
		case <-p.done:
		}
	case frameData:
		if !p.started || !p.hasBody {
			return errors.New("desktop data before body start")
		}
		if _, err := p.writer.Write(f.payload); err != nil {
			select {
			case <-p.done:
				return nil
			default:
				return err
			}
		}
	case frameEnd:
		if !p.started || len(f.payload) != 0 {
			return errors.New("invalid desktop response end")
		}
		c.finish(f.id, nil)
	case frameCancel:
		var detail struct {
			Message string `json:"message"`
		}
		if json.Unmarshal(f.payload, &detail) != nil {
			return errors.New("invalid desktop response error")
		}
		c.finish(f.id, errors.New(detail.Message))
	default:
		return errors.New("unknown desktop response frame")
	}
	return nil
}

type responseBody struct {
	io.ReadCloser
	once   sync.Once
	cancel func()
}

func (b *responseBody) Close() error {
	// Mark the stream canceled before releasing a blocked writer. Otherwise the
	// shared reader can mistake this normal local close for a broken Host pipe.
	b.once.Do(b.cancel)
	return b.ReadCloser.Close()
}

// RoundTrip accepts only the official app origin; it cannot proxy network URLs.
func (c *Client) RoundTrip(request *http.Request) (*http.Response, error) {
	if request.URL == nil || request.URL.Scheme != "dsh-app" || request.URL.Host != "app" || request.URL.User != nil {
		return nil, errors.New("desktop requests must use dsh-app://app")
	}
	if err := request.Context().Err(); err != nil {
		return nil, err
	}
	headers := make([][2]string, 0)
	for name, values := range request.Header {
		for _, value := range values {
			headers = append(headers, [2]string{name, value})
		}
	}
	hasBody := request.Body != nil && request.Body != http.NoBody && request.Method != "GET" && request.Method != "HEAD"
	metadata, err := json.Marshal(map[string]any{"url": request.URL.String(), "method": request.Method, "headers": headers, "hasBody": hasBody})
	if err != nil {
		return nil, err
	}
	c.beginMu.Lock()
	c.mu.Lock()
	if c.closing || c.err != nil || c.nextID > 0xffffffff {
		c.mu.Unlock()
		c.beginMu.Unlock()
		return nil, errors.New("desktop transport unavailable")
	}
	id := uint32(c.nextID)
	c.nextID++
	reader, writer := io.Pipe()
	p := &pending{header: make(chan responseResult, 1), credit: make(chan struct{}, 1), done: make(chan struct{}), reader: reader, writer: writer, request: request}
	if hasBody {
		p.upload = request.Body
	}
	c.pending[id] = p
	c.mu.Unlock()
	err = c.write(frameStart, id, metadata)
	c.beginMu.Unlock()
	if err != nil {
		c.fail(err)
		return nil, err
	}
	go func() {
		select {
		case <-request.Context().Done():
			c.cancel(id, request.Context().Err())
		case <-p.done:
		}
	}()
	if hasBody {
		go c.upload(id, p)
	}
	select {
	case result := <-p.header:
		return result.response, result.err
	case <-request.Context().Done():
		c.cancel(id, request.Context().Err())
		return nil, request.Context().Err()
	case <-c.done:
		return nil, c.failure()
	}
}

func (c *Client) upload(id uint32, p *pending) {
	buffer := make([]byte, chunkBytes)
	for {
		select {
		case <-p.credit:
		case <-p.done:
			return
		case <-c.done:
			return
		}
		n, err := p.upload.Read(buffer)
		if n > 0 {
			if writeErr := c.write(frameData, id, buffer[:n]); writeErr != nil {
				c.fail(writeErr)
				return
			}
		}
		if err != nil {
			if err == io.EOF {
				// A frame carrying bytes consumes the credit; end needs the next pull.
				if n > 0 {
					select {
					case <-p.credit:
					case <-p.done:
						return
					case <-c.done:
						return
					}
				}
				if writeErr := c.write(frameEnd, id, nil); writeErr != nil {
					c.fail(writeErr)
				}
			} else {
				c.cancel(id, err)
			}
			return
		}
		if n == 0 {
			c.cancel(id, io.ErrNoProgress)
			return
		}
	}
}

func (c *Client) Close(ctx context.Context) error {
	c.mu.Lock()
	already := c.closing
	c.closing = true
	ids := make([]uint32, 0, len(c.pending))
	for id := range c.pending {
		ids = append(ids, id)
	}
	c.mu.Unlock()
	for _, id := range ids {
		c.finish(id, errors.New("desktop transport closing"))
	}
	if !already {
		// A stalled child may stop consuming stdin. Let the caller's shutdown
		// context terminate that write and its whole process tree.
		go func() { _ = c.write(frameShutdown, 0, nil) }()
	}
	select {
	case <-c.exited:
		c.mu.Lock()
		err := c.waitErr
		c.mu.Unlock()
		return err
	case <-ctx.Done():
		c.forceStop()
		return ctx.Err()
	}
}

// Handler streams a local carrier request to the official desktop origin while
// query, Range and cancellation remain. Wails' finite AssetServer uses WailsHandler.
func (c *Client) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
		for name, values := range response.Header {
			for _, value := range values {
				w.Header().Add(name, value)
			}
		}
		w.WriteHeader(response.StatusCode)
		buffer := make([]byte, chunkBytes)
		for {
			n, err := response.Body.Read(buffer)
			if n > 0 {
				if _, writeErr := w.Write(buffer[:n]); writeErr != nil {
					return
				}
				if flusher, ok := w.(http.Flusher); ok {
					flusher.Flush()
				}
			}
			if err != nil {
				return
			}
		}
	})
}
