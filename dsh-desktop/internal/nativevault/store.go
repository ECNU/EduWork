package nativevault

import (
	"errors"
	"regexp"
)

const maxSecretBytes = 5 * 1024

var credentialRefPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
var namespacePattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9._-]{0,79}$`)

func validateNamespace(namespace string) error {
	if !namespacePattern.MatchString(namespace) {
		return errors.New("native vault namespace must be a stable application identifier")
	}
	return nil
}

// Store is the narrow native-secret seam exposed to the DSH credential
// provider. Implementations must scope values to the current operating-system
// user and must not materialize them in ordinary files.
type Store interface {
	Resolve(ref string) (value string, configured bool, err error)
	Set(ref, value string) error
	Unset(ref string) error
	Source() string
}

func validateRef(ref string) error {
	if !credentialRefPattern.MatchString(ref) {
		return errors.New("credential reference must be a POSIX identifier")
	}
	return nil
}

func validateValue(value string) error {
	if value == "" {
		return errors.New("empty credential values are not allowed; use unset")
	}
	if len([]byte(value)) > maxSecretBytes {
		return errors.New("credential value exceeds the native vault limit")
	}
	return nil
}
