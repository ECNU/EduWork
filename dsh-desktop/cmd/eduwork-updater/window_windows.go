//go:build windows

package main

import (
	"fmt"
	"runtime"
	"sync"
	"syscall"
	"unsafe"

	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/updater"
)

// The detached installer cannot depend on files inside the installation it
// replaces, or on WebView2. A small native window keeps progress and failures
// visible even after Electron has released all its files.
func applyWithWindow(pending string, pid int) error {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	user := syscall.NewLazyDLL("user32.dll")
	proc := func(name string) *syscall.LazyProc { return user.NewProc(name) }
	utf := func(s string) *uint16 { p, _ := syscall.UTF16PtrFromString(s); return p }
	type class struct {
		Size, Style                        uint32
		Procedure                          uintptr
		ClassExtra, WindowExtra            int32
		Instance, Icon, Cursor, Background uintptr
		Menu, Name                         *uint16
		SmallIcon                          uintptr
	}
	type message struct {
		Window         uintptr
		ID             uint32
		WParam, LParam uintptr
		Time           uint32
		X, Y           int32
		Private        uint32
	}
	type controls struct{ Size, Classes uint32 }
	common := controls{8, 0x20}
	syscall.NewLazyDLL("comctl32.dll").NewProc("InitCommonControlsEx").Call(uintptr(unsafe.Pointer(&common)))
	var mu sync.Mutex
	state := updater.ApplyProgress{Message: "正在等待应用退出…"}
	var result error
	done := false
	var label, bar uintptr
	setText := func(window uintptr, text string) {
		proc("SetWindowTextW").Call(window, uintptr(unsafe.Pointer(utf(text))))
	}
	handler := syscall.NewCallback(func(window uintptr, id uint32, w, l uintptr) uintptr {
		switch id {
		case 0x8010:
			mu.Lock()
			p, finished, err := state, done, result
			mu.Unlock()
			if finished && err != nil {
				setText(label, "更新未完成，请重试。\r\n"+err.Error())
				proc("SetWindowTextW").Call(window, uintptr(unsafe.Pointer(utf("EduWork 更新未完成"))))
			} else {
				setText(label, p.Message)
			}
			proc("SendMessageW").Call(bar, 0x402, uintptr(p.Percent), 0)
			if finished && err == nil {
				proc("DestroyWindow").Call(window)
			}
			return 0
		case 0x10: // Do not interrupt a transaction by closing its progress window.
			mu.Lock()
			finished := done
			mu.Unlock()
			if finished {
				proc("DestroyWindow").Call(window)
			}
			return 0
		case 0x2:
			proc("PostQuitMessage").Call(0)
			return 0
		}
		ret, _, _ := proc("DefWindowProcW").Call(window, uintptr(id), w, l)
		return ret
	})
	instance, _, _ := syscall.NewLazyDLL("kernel32.dll").NewProc("GetModuleHandleW").Call(0)
	cursor, _, _ := proc("LoadCursorW").Call(0, 32512)
	c := class{Procedure: handler, Instance: instance, Cursor: cursor, Background: 6, Name: utf("EduWorkPortableInstaller")}
	c.Size = uint32(unsafe.Sizeof(c))
	if ok, _, err := proc("RegisterClassExW").Call(uintptr(unsafe.Pointer(&c))); ok == 0 {
		return fmt.Errorf("create installer window: %w", err)
	}
	create := func(kind, text string, style uintptr, x, y, width, height int, parent uintptr) uintptr {
		w, _, _ := proc("CreateWindowExW").Call(0, uintptr(unsafe.Pointer(utf(kind))), uintptr(unsafe.Pointer(utf(text))), style, uintptr(x), uintptr(y), uintptr(width), uintptr(height), parent, 0, instance, 0)
		return w
	}
	screenW, _, _ := proc("GetSystemMetrics").Call(0)
	screenH, _, _ := proc("GetSystemMetrics").Call(1)
	window := create("EduWorkPortableInstaller", "正在更新 EduWork", 0x00C80000, int(screenW)/2-300, int(screenH)/2-145, 600, 290, 0)
	if window == 0 {
		return fmt.Errorf("cannot open installer progress window")
	}
	label = create("STATIC", state.Message, 0x50000000, 24, 24, 538, 148, window)
	bar = create("msctls_progress32", "", 0x50000000, 24, 192, 538, 16, window)
	font, _, _ := syscall.NewLazyDLL("gdi32.dll").NewProc("GetStockObject").Call(17)
	proc("SendMessageW").Call(label, 0x30, font, 1)
	proc("ShowWindow").Call(window, 1)
	proc("UpdateWindow").Call(window)
	go func() {
		err := updater.ApplyPendingWithProgress(pending, pid, func(p updater.ApplyProgress) {
			mu.Lock()
			state = p
			mu.Unlock()
			proc("PostMessageW").Call(window, 0x8010, 0, 0)
		})
		mu.Lock()
		done = true
		result = err
		mu.Unlock()
		proc("PostMessageW").Call(window, 0x8010, 0, 0)
	}()
	var m message
	for {
		code, _, _ := proc("GetMessageW").Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(code) <= 0 {
			break
		}
		proc("TranslateMessage").Call(uintptr(unsafe.Pointer(&m)))
		proc("DispatchMessageW").Call(uintptr(unsafe.Pointer(&m)))
	}
	mu.Lock()
	defer mu.Unlock()
	return result
}
