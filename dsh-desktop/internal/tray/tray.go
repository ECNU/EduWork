// Package tray owns the optional native desktop notification-area surface.
// It deliberately exposes product actions instead of DSH internals so the
// portable shell remains replaceable and the web runtime stays browser-safe.
package tray

import "errors"

// Action identifies one user choice from the native tray menu.
type Action string

const (
	ActionOpen         Action = "open"
	ActionNewSession   Action = "new-session"
	ActionCheckUpdates Action = "check-updates"
	ActionSettings     Action = "settings"
	ActionExit         Action = "exit"
)

// Options configures the native tray surface.
type Options struct {
	Tooltip string
	// Minimal is reserved for startup-only surfaces. Product shells use all actions.
	Minimal      bool
	IconPath     string
	OnAction     func(Action)
	OnDiagnostic func(string)
}

// Controller is the lifecycle handle for a successfully created tray icon.
type Controller interface {
	Notify(title, message string) error
	Close() error
}

// ErrUnsupported reports that this host does not yet have a native backend.
var ErrUnsupported = errors.New("system tray is unsupported on this platform")
