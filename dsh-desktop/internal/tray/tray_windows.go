//go:build windows

package tray

import (
	"errors"
	"fmt"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	wmDestroy       = 0x0002
	wmClose         = 0x0010
	wmNull          = 0x0000
	wmContextMenu   = 0x007B
	wmCommand       = 0x0111
	wmLButtonDblClk = 0x0203
	wmRButtonUp     = 0x0205
	wmTrayCallback  = 0x8001

	nimAdd        = 0x00000000
	nimModify     = 0x00000001
	nimDelete     = 0x00000002
	nimSetVersion = 0x00000004

	nifMessage = 0x00000001
	nifIcon    = 0x00000002
	nifTip     = 0x00000004
	nifInfo    = 0x00000010

	niifInfo = 0x00000001

	imageIcon      = 1
	lrDefaultSize  = 0x00000040
	lrLoadFromFile = 0x00000010
	idiApplication = 32512

	mfString    = 0x00000000
	mfSeparator = 0x00000800

	tpmRightButton = 0x0002
	tpmReturnCmd   = 0x0100

	swHide = 0

	menuOpen         = 1001
	menuNewSession   = 1002
	menuCheckUpdates = 1003
	menuSettings     = 1004
	menuExit         = 1005
)

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	shell32  = windows.NewLazySystemDLL("shell32.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")

	procRegisterClassExW  = user32.NewProc("RegisterClassExW")
	procUnregisterClassW  = user32.NewProc("UnregisterClassW")
	procCreateWindowExW   = user32.NewProc("CreateWindowExW")
	procDestroyWindow     = user32.NewProc("DestroyWindow")
	procDefWindowProcW    = user32.NewProc("DefWindowProcW")
	procGetMessageW       = user32.NewProc("GetMessageW")
	procTranslateMessage  = user32.NewProc("TranslateMessage")
	procDispatchMessageW  = user32.NewProc("DispatchMessageW")
	procPostMessageW      = user32.NewProc("PostMessageW")
	procPostQuitMessage   = user32.NewProc("PostQuitMessage")
	procCreatePopupMenu   = user32.NewProc("CreatePopupMenu")
	procAppendMenuW       = user32.NewProc("AppendMenuW")
	procDestroyMenu       = user32.NewProc("DestroyMenu")
	procTrackPopupMenu    = user32.NewProc("TrackPopupMenu")
	procGetCursorPos      = user32.NewProc("GetCursorPos")
	procSetForegroundWind = user32.NewProc("SetForegroundWindow")
	procShowWindow        = user32.NewProc("ShowWindow")
	procLoadImageW        = user32.NewProc("LoadImageW")
	procLoadIconW         = user32.NewProc("LoadIconW")
	procDestroyIcon       = user32.NewProc("DestroyIcon")
	procGetModuleHandleW  = kernel32.NewProc("GetModuleHandleW")
	procShellNotifyIconW  = shell32.NewProc("Shell_NotifyIconW")

	windowProcPointer = syscall.NewCallback(windowProc)
	activeMu          sync.Mutex
	activeController  *controller
)

type point struct {
	x int32
	y int32
}

type message struct {
	hwnd     uintptr
	message  uint32
	wParam   uintptr
	lParam   uintptr
	time     uint32
	position point
	private  uint32
}

type windowClassEx struct {
	size        uint32
	style       uint32
	windowProc  uintptr
	classExtra  int32
	windowExtra int32
	instance    uintptr
	icon        uintptr
	cursor      uintptr
	background  uintptr
	menuName    *uint16
	className   *uint16
	smallIcon   uintptr
}

type notifyIconData struct {
	size             uint32
	hwnd             uintptr
	id               uint32
	flags            uint32
	callbackMessage  uint32
	icon             uintptr
	tip              [128]uint16
	state            uint32
	stateMask        uint32
	info             [256]uint16
	timeoutOrVersion uint32
	infoTitle        [64]uint16
	infoFlags        uint32
	guid             windows.GUID
	balloonIcon      uintptr
}

type controller struct {
	options Options

	mu        sync.Mutex
	hwnd      uintptr
	icon      uintptr
	ownsIcon  bool
	closed    bool
	ready     chan error
	closeOnce sync.Once
}

// Start creates the Windows notification-area icon on its own native message
// loop. Wails keeps ownership of the application/window message loop.
func Start(options Options) (Controller, error) {
	if strings.TrimSpace(options.Tooltip) == "" {
		options.Tooltip = "ChatECNU Work"
	}
	instance := &controller{options: options, ready: make(chan error, 1)}
	activeMu.Lock()
	if activeController != nil {
		activeMu.Unlock()
		return nil, errors.New("system tray is already running")
	}
	activeController = instance
	activeMu.Unlock()
	go instance.run()
	if err := <-instance.ready; err != nil {
		activeMu.Lock()
		if activeController == instance {
			activeController = nil
		}
		activeMu.Unlock()
		return nil, err
	}
	return instance, nil
}

func (instance *controller) run() {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	module, _, moduleErr := procGetModuleHandleW.Call(0)
	if module == 0 {
		instance.ready <- windowsError("GetModuleHandleW", moduleErr)
		return
	}
	className, _ := windows.UTF16PtrFromString(fmt.Sprintf("ChatECNUWorkTray-%d", windows.GetCurrentProcessId()))
	class := windowClassEx{
		size: uint32(unsafe.Sizeof(windowClassEx{})), windowProc: windowProcPointer,
		instance: module, className: className,
	}
	atom, _, registerErr := procRegisterClassExW.Call(uintptr(unsafe.Pointer(&class)))
	if atom == 0 {
		instance.ready <- windowsError("RegisterClassExW", registerErr)
		return
	}
	defer procUnregisterClassW.Call(uintptr(unsafe.Pointer(className)), module)

	hwnd, _, createErr := procCreateWindowExW.Call(
		0, uintptr(unsafe.Pointer(className)), uintptr(unsafe.Pointer(className)), 0,
		0, 0, 0, 0, 0, 0, module, 0,
	)
	if hwnd == 0 {
		instance.ready <- windowsError("CreateWindowExW", createErr)
		return
	}
	instance.diagnose(fmt.Sprintf("native tray window created: pid=%d hwnd=%d", windows.GetCurrentProcessId(), hwnd))
	procShowWindow.Call(hwnd, swHide)
	icon, ownsIcon := loadIcon(instance.options.IconPath)
	data := notifyIconData{
		size: uint32(unsafe.Sizeof(notifyIconData{})), hwnd: hwnd, id: 1,
		flags: nifMessage | nifIcon | nifTip, callbackMessage: wmTrayCallback, icon: icon,
	}
	copyUTF16(data.tip[:], instance.options.Tooltip)
	added, _, addErr := procShellNotifyIconW.Call(nimAdd, uintptr(unsafe.Pointer(&data)))
	if added == 0 {
		procDestroyWindow.Call(hwnd)
		if ownsIcon && icon != 0 {
			procDestroyIcon.Call(icon)
		}
		instance.ready <- windowsError("Shell_NotifyIconW(NIM_ADD)", addErr)
		return
	}
	instance.diagnose("notification icon registered")
	data.timeoutOrVersion = 4
	procShellNotifyIconW.Call(nimSetVersion, uintptr(unsafe.Pointer(&data)))

	instance.mu.Lock()
	instance.hwnd, instance.icon, instance.ownsIcon = hwnd, icon, ownsIcon
	instance.mu.Unlock()
	instance.ready <- nil

	var incoming message
	for {
		result, _, messageErr := procGetMessageW.Call(uintptr(unsafe.Pointer(&incoming)), 0, 0, 0)
		if int32(result) <= 0 {
			instance.diagnose(fmt.Sprintf("native tray message loop stopped: result=%d error=%v", int32(result), messageErr))
			break
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&incoming)))
		procDispatchMessageW.Call(uintptr(unsafe.Pointer(&incoming)))
	}

	data.flags = 0
	procShellNotifyIconW.Call(nimDelete, uintptr(unsafe.Pointer(&data)))
	if ownsIcon && icon != 0 {
		procDestroyIcon.Call(icon)
	}
	instance.mu.Lock()
	instance.hwnd, instance.icon, instance.closed = 0, 0, true
	instance.mu.Unlock()
	activeMu.Lock()
	if activeController == instance {
		activeController = nil
	}
	activeMu.Unlock()
}

func (instance *controller) diagnose(message string) {
	if instance.options.OnDiagnostic != nil {
		instance.options.OnDiagnostic(message)
	}
}

func (instance *controller) Notify(title, body string) error {
	instance.mu.Lock()
	defer instance.mu.Unlock()
	if instance.closed || instance.hwnd == 0 {
		return errors.New("system tray is not running")
	}
	data := notifyIconData{
		size: uint32(unsafe.Sizeof(notifyIconData{})), hwnd: instance.hwnd, id: 1,
		flags: nifInfo, infoFlags: niifInfo,
	}
	copyUTF16(data.infoTitle[:], title)
	copyUTF16(data.info[:], body)
	result, _, callErr := procShellNotifyIconW.Call(nimModify, uintptr(unsafe.Pointer(&data)))
	if result == 0 {
		return windowsError("Shell_NotifyIconW(NIM_MODIFY)", callErr)
	}
	return nil
}

func (instance *controller) Close() error {
	instance.closeOnce.Do(func() {
		instance.mu.Lock()
		hwnd := instance.hwnd
		instance.mu.Unlock()
		if hwnd != 0 {
			procPostMessageW.Call(hwnd, wmClose, 0, 0)
		}
	})
	return nil
}

func windowProc(hwnd uintptr, msg uint32, wParam, lParam uintptr) uintptr {
	switch msg {
	case wmTrayCallback:
		event := uint32(lParam) & 0xffff
		switch event {
		case wmLButtonDblClk:
			dispatch(ActionOpen)
			return 0
		case wmRButtonUp, wmContextMenu:
			showMenu(hwnd)
			return 0
		}
	case wmCommand:
		dispatchMenuCommand(wParam & 0xffff)
		return 0
	case wmClose:
		diagnoseActive("native tray window received WM_CLOSE")
		procDestroyWindow.Call(hwnd)
		return 0
	case wmDestroy:
		diagnoseActive("native tray window received WM_DESTROY")
		procPostQuitMessage.Call(0)
		return 0
	}
	result, _, _ := procDefWindowProcW.Call(hwnd, uintptr(msg), wParam, lParam)
	return result
}

func diagnoseActive(message string) {
	activeMu.Lock()
	instance := activeController
	activeMu.Unlock()
	if instance != nil {
		instance.diagnose(message)
	}
}

func showMenu(hwnd uintptr) {
	menu, _, _ := procCreatePopupMenu.Call()
	if menu == 0 {
		return
	}
	defer procDestroyMenu.Call(menu)
	activeMu.Lock()
	instance := activeController
	activeMu.Unlock()
	if instance == nil {
		return
	}
	appendMenu(menu, mfString, menuOpen, "打开 "+instance.options.Tooltip)
	if !instance.options.Minimal {
		appendMenu(menu, mfString, menuNewSession, "新建会话")
		appendMenu(menu, mfSeparator, 0, "")
		appendMenu(menu, mfString, menuCheckUpdates, "检查更新")
		appendMenu(menu, mfString, menuSettings, "设置")
	}
	appendMenu(menu, mfSeparator, 0, "")
	appendMenu(menu, mfString, menuExit, "退出 "+instance.options.Tooltip)
	var cursor point
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&cursor)))
	procSetForegroundWind.Call(hwnd)
	command, _, _ := procTrackPopupMenu.Call(
		menu, tpmRightButton|tpmReturnCmd, uintptr(cursor.x), uintptr(cursor.y), 0, hwnd, 0,
	)
	procPostMessageW.Call(hwnd, wmNull, 0, 0)
	dispatchMenuCommand(command)
}

func dispatchMenuCommand(command uintptr) {
	switch command {
	case menuOpen:
		dispatch(ActionOpen)
	case menuNewSession:
		dispatch(ActionNewSession)
	case menuCheckUpdates:
		dispatch(ActionCheckUpdates)
	case menuSettings:
		dispatch(ActionSettings)
	case menuExit:
		dispatch(ActionExit)
	}
}

func dispatch(action Action) {
	activeMu.Lock()
	instance := activeController
	activeMu.Unlock()
	if instance != nil && instance.options.OnAction != nil {
		go instance.options.OnAction(action)
	}
}

func appendMenu(menu uintptr, flags uint32, id uintptr, label string) {
	var pointer *uint16
	if label != "" {
		pointer, _ = windows.UTF16PtrFromString(label)
	}
	procAppendMenuW.Call(menu, uintptr(flags), id, uintptr(unsafe.Pointer(pointer)))
}

func loadIcon(path string) (uintptr, bool) {
	if strings.TrimSpace(path) != "" {
		pointer, _ := windows.UTF16PtrFromString(path)
		icon, _, _ := procLoadImageW.Call(0, uintptr(unsafe.Pointer(pointer)), imageIcon, 0, 0, lrLoadFromFile|lrDefaultSize)
		if icon != 0 {
			return icon, true
		}
	}
	icon, _, _ := procLoadIconW.Call(0, idiApplication)
	return icon, false
}

func copyUTF16(target []uint16, value string) {
	encoded, _ := windows.UTF16FromString(value)
	if len(encoded) > len(target) {
		encoded = encoded[:len(target)]
		encoded[len(encoded)-1] = 0
	}
	copy(target, encoded)
}

func windowsError(operation string, err error) error {
	if err == nil || errors.Is(err, windows.ERROR_SUCCESS) {
		return errors.New(operation + " failed")
	}
	return fmt.Errorf("%s: %w", operation, err)
}
