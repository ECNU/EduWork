//go:build windows

package nativevault

import (
	"errors"
	"runtime"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	credentialTypeGeneric         = 1
	credentialPersistLocalMachine = 2
	credentialTargetPrefix        = "ChatECNU Work/DSH/"
)

var (
	advapi32        = windows.NewLazySystemDLL("advapi32.dll")
	procCredWriteW  = advapi32.NewProc("CredWriteW")
	procCredReadW   = advapi32.NewProc("CredReadW")
	procCredDeleteW = advapi32.NewProc("CredDeleteW")
	procCredFree    = advapi32.NewProc("CredFree")
)

type windowsCredential struct {
	Flags              uint32
	Type               uint32
	TargetName         *uint16
	Comment            *uint16
	LastWritten        windows.Filetime
	CredentialBlobSize uint32
	CredentialBlob     *byte
	Persist            uint32
	AttributeCount     uint32
	Attributes         uintptr
	TargetAlias        *uint16
	UserName           *uint16
}

type windowsStore struct{ prefix string }

func DefaultStore() (Store, error) { return windowsStore{}, nil }

// NewNamespacedStore isolates candidate/public editions from the existing store.
// DefaultStore retains its historical targets and behavior for current users.
func NewNamespacedStore(namespace string) (Store, error) {
	if err := validateNamespace(namespace); err != nil {
		return nil, err
	}
	return windowsStore{prefix: "EduWork/" + namespace + "/"}, nil
}

func (store windowsStore) targetPrefix() string {
	if store.prefix == "" {
		return credentialTargetPrefix
	}
	return store.prefix
}

func (windowsStore) Source() string { return "windows-credential-manager" }

func (store windowsStore) Resolve(ref string) (string, bool, error) {
	if err := validateRef(ref); err != nil {
		return "", false, err
	}
	target, err := windows.UTF16PtrFromString(store.targetPrefix() + ref)
	if err != nil {
		return "", false, err
	}
	var credential *windowsCredential
	result, _, callErr := procCredReadW.Call(
		uintptr(unsafe.Pointer(target)),
		credentialTypeGeneric,
		0,
		uintptr(unsafe.Pointer(&credential)),
	)
	if result == 0 {
		if errors.Is(callErr, windows.ERROR_NOT_FOUND) {
			return "", false, nil
		}
		return "", false, callErr
	}
	defer procCredFree.Call(uintptr(unsafe.Pointer(credential)))
	if credential == nil || credential.CredentialBlobSize == 0 || credential.CredentialBlob == nil {
		return "", false, nil
	}
	if credential.CredentialBlobSize > maxSecretBytes {
		return "", false, errors.New("native credential exceeds supported size")
	}
	bytes := unsafe.Slice(credential.CredentialBlob, int(credential.CredentialBlobSize))
	copyOfSecret := append([]byte(nil), bytes...)
	value := string(copyOfSecret)
	clear(copyOfSecret)
	return value, true, nil
}

func (store windowsStore) Set(ref, value string) error {
	if err := validateRef(ref); err != nil {
		return err
	}
	if err := validateValue(value); err != nil {
		return err
	}
	target, err := windows.UTF16PtrFromString(store.targetPrefix() + ref)
	if err != nil {
		return err
	}
	productName := "ChatECNU Work"
	if store.prefix != "" {
		productName = "EduWork"
	}
	username, err := windows.UTF16PtrFromString(productName)
	if err != nil {
		return err
	}
	secret := []byte(value)
	defer clear(secret)
	credential := windowsCredential{
		Type:               credentialTypeGeneric,
		TargetName:         target,
		CredentialBlobSize: uint32(len(secret)),
		CredentialBlob:     &secret[0],
		Persist:            credentialPersistLocalMachine,
		UserName:           username,
	}
	result, _, callErr := procCredWriteW.Call(uintptr(unsafe.Pointer(&credential)), 0)
	runtime.KeepAlive(secret)
	runtime.KeepAlive(target)
	runtime.KeepAlive(username)
	if result == 0 {
		return callErr
	}
	return nil
}

func (store windowsStore) Unset(ref string) error {
	if err := validateRef(ref); err != nil {
		return err
	}
	target, err := windows.UTF16PtrFromString(store.targetPrefix() + ref)
	if err != nil {
		return err
	}
	result, _, callErr := procCredDeleteW.Call(uintptr(unsafe.Pointer(target)), credentialTypeGeneric, 0)
	if result == 0 && !errors.Is(callErr, windows.ERROR_NOT_FOUND) {
		return callErr
	}
	return nil
}
