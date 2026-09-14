//go:build !windows

package nativevault

import "errors"

func DefaultStore() (Store, error) {
	return nil, errors.New("native vault provider is not implemented for this platform")
}

func NewNamespacedStore(namespace string) (Store, error) {
	if err := validateNamespace(namespace); err != nil {
		return nil, err
	}
	return DefaultStore()
}
