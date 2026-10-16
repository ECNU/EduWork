// Package workspaceaccess repairs only a confirmed missing WRITE_OWNER on a
// caller-owned workspace root. The official sandbox retains grant provisioning.
package workspaceaccess

type Result struct {
	Status      string `json:"status"`
	Path        string `json:"path"`
	Fingerprint string `json:"fingerprint,omitempty"`
	Before      string `json:"before,omitempty"`
	After       string `json:"after,omitempty"`
}
