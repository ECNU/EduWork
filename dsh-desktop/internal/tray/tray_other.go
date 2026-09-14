//go:build !windows

package tray

// Start is a safe no-op on platforms whose native tray backend is not shipped.
func Start(Options) (Controller, error) { return nil, ErrUnsupported }
