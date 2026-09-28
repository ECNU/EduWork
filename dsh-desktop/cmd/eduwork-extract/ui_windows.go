package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"syscall"
	"unsafe"

	"github.com/ecnu/chatecnu-work-dsh-desktop/internal/portable"
	"golang.org/x/sys/windows"
)

var user = windows.NewLazySystemDLL("user32.dll")
var gdi = windows.NewLazySystemDLL("gdi32.dll")
var shell = windows.NewLazySystemDLL("shell32.dll")
var ole = windows.NewLazySystemDLL("ole32.dll")
var instance uintptr
var window, location, browseButton, startButton, cancelButton, status, progress uintptr
var fonts []uintptr
var busy, finished, closeAfterCancel bool
var cancel context.CancelFunc
var installed string
var updates = make(chan portable.Progress, 1)

type outcome struct {
	path string
	err  error
}

var results = make(chan outcome, 1)
var scale = 1.0

func ptr(s string) uintptr { return uintptr(unsafe.Pointer(windows.StringToUTF16Ptr(s))) }
func call(name string, args ...uintptr) uintptr {
	r, _, _ := user.NewProc(name).Call(args...)
	return r
}
func text(h uintptr, s string) { call("SetWindowTextW", h, ptr(s)) }
func enable(h uintptr, yes bool) {
	n := uintptr(0)
	if yes {
		n = 1
	}
	call("EnableWindow", h, n)
}
func message(h uintptr, s string) {
	call("MessageBoxW", h, ptr(s), ptr(identity.Product+" 安装程序"), 0x10)
}
func px(n int) uintptr { return uintptr(int(float64(n) * scale)) }
func readText(h uintptr) string {
	n := call("GetWindowTextLengthW", h)
	b := make([]uint16, n+1)
	call("GetWindowTextW", h, uintptr(unsafe.Pointer(&b[0])), n+1)
	return windows.UTF16ToString(b)
}
func control(class, title string, style uintptr, x, y, w, h, id int) uintptr {
	r := call("CreateWindowExW", 0, ptr(class), ptr(title), 0x50000000|style, px(x), px(y), px(w), px(h), window, uintptr(id), instance, 0)
	call("SendMessageW", r, 0x30, fonts[0], 1)
	return r
}
func font(size, weight int) uintptr {
	h, _, _ := gdi.NewProc("CreateFontW").Call(uintptr(int32(-int(float64(size)*scale))), 0, 0, 0, uintptr(weight), 0, 0, 0, 1, 0, 0, 5, 0, ptr("Segoe UI"))
	fonts = append(fonts, h)
	return h
}

type wndClass struct {
	Size, Style                        uint32
	Proc                               uintptr
	ClassExtra, WindowExtra            int32
	Instance, Icon, Cursor, Background uintptr
	Menu, Name                         *uint16
	SmallIcon                          uintptr
}
type point struct{ X, Y int32 }
type msg struct {
	Window         uintptr
	Message        uint32
	WParam, LParam uintptr
	Time           uint32
	Point          point
	Private        uint32
}
type rect struct{ Left, Top, Right, Bottom int32 }

func chooseFolder() {
	// The existing-folder chooser avoids creating directories outside our target.
	var pathBuf [32768]uint16
	var display [260]uint16
	type info struct {
		Owner, Root     uintptr
		Display         *uint16
		Title           *uint16
		Flags           uint32
		Callback, Param uintptr
		Image           int32
	}
	b := info{Owner: window, Display: &display[0], Title: windows.StringToUTF16Ptr("选择安装位置的上级目录"), Flags: 0x41}
	id, _, _ := shell.NewProc("SHBrowseForFolderW").Call(uintptr(unsafe.Pointer(&b)))
	if id == 0 {
		return
	}
	defer ole.NewProc("CoTaskMemFree").Call(id)
	ok, _, _ := shell.NewProc("SHGetPathFromIDListEx").Call(id, uintptr(unsafe.Pointer(&pathBuf[0])), uintptr(len(pathBuf)), 0)
	if ok != 0 {
		text(location, filepath.Join(windows.UTF16ToString(pathBuf[:]), identity.Root))
	}
}
func begin() {
	target := readText(location)
	if target == "" {
		message(window, "请选择安装位置。")
		return
	}
	busy = true
	enable(location, false)
	enable(browseButton, false)
	enable(startButton, false)
	text(cancelButton, "取消安装")
	text(status, "正在检查安装包完整性…")
	call("SendMessageW", progress, 0x402, 0, 0)
	var ctx context.Context
	ctx, cancel = context.WithCancel(context.Background())
	go func() {
		path, err := unpack(ctx, target, false, func(p portable.Progress) {
			select {
			case updates <- p:
			default:
			}
		})
		results <- outcome{path, err}
	}()
}
func cancelWork(closeWindow bool) {
	if busy {
		closeAfterCancel = closeWindow
		cancel()
		enable(cancelButton, false)
		text(status, "正在取消，等待本次临时文件清理完成…")
		return
	}
	call("DestroyWindow", window)
}
func tick() {
	select {
	case p := <-updates:
		text(status, p.Message)
		call("SendMessageW", progress, 0x402, uintptr(p.Percent), 0)
	default:
	}
	select {
	case r := <-results:
		busy = false
		cancel()
		enable(cancelButton, true)
		// Do not let a queued progress event overwrite the final result.
		select {
		case <-updates:
		default:
		}
		if closeAfterCancel {
			if r.err != nil && r.err != context.Canceled {
				message(window, r.err.Error())
			}
			call("DestroyWindow", window)
			return
		}
		if r.err != nil {
			enable(location, true)
			enable(browseButton, true)
			enable(startButton, true)
			text(cancelButton, "关闭")
			text(status, "未完成安装。请检查提示后重试。")
			if r.err == context.Canceled {
				text(status, "已取消安装。")
			} else {
				message(window, r.err.Error())
			}
			return
		}
		finished = true
		installed = r.path
		text(status, "安装完成，可以启动应用了。")
		call("SendMessageW", progress, 0x402, 100, 0)
		text(startButton, "立即启动")
		enable(startButton, true)
		text(cancelButton, "完成")
		call("SetFocus", startButton)
	default:
	}
}
func procedure(h uintptr, m uint32, w, l uintptr) uintptr {
	switch m {
	case 0x138: // Match native static labels to the window background.
		gdi.NewProc("SetBkMode").Call(w, 1)
		return call("GetSysColorBrush", 5)
	case 0x111:
		switch w & 0xffff {
		case 101:
			if !busy && !finished {
				chooseFolder()
			}
		case 1, 102:
			if busy {
				return 0
			}
			if !finished {
				begin()
			} else {
				cmd := exec.Command(filepath.Join(installed, "EduWork-Electron.exe"))
				cmd.Dir = installed
				if err := cmd.Start(); err != nil {
					message(window, fmt.Sprintf("应用已安装，但启动失败。请检查安全软件记录，或在应用目录中手动启动。\n\n%s", err))
				} else {
					_ = cmd.Process.Release()
					call("DestroyWindow", window)
				}
			}
		case 2, 103:
			cancelWork(false)
		}
		return 0
	case 0x113:
		tick()
		return 0
	case 0x10:
		cancelWork(true)
		return 0
	case 2:
		call("PostQuitMessage", 0)
		return 0
	}
	return call("DefWindowProcW", h, uintptr(m), w, l)
}
func runUI() {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	ole.NewProc("CoInitializeEx").Call(0, 2)
	defer ole.NewProc("CoUninitialize").Call()
	instance, _, _ = windows.NewLazySystemDLL("kernel32.dll").NewProc("GetModuleHandleW").Call(0)
	if p := user.NewProc("GetDpiForSystem"); p.Find() == nil {
		dpi, _, _ := p.Call()
		scale = float64(dpi) / 96
	}
	cc := struct{ Size, Classes uint32 }{8, 0x20}
	windows.NewLazySystemDLL("comctl32.dll").NewProc("InitCommonControlsEx").Call(uintptr(unsafe.Pointer(&cc)))
	font(16, 400)
	font(25, 600)
	defer func() {
		for _, f := range fonts {
			gdi.NewProc("DeleteObject").Call(f)
		}
	}()
	icon := call("LoadImageW", instance, 1, 1, px(48), px(48), 0x8000)
	smallIcon := call("LoadImageW", instance, 1, 1, px(16), px(16), 0x8000)
	name := windows.StringToUTF16Ptr("EduWorkPortableExtractor")
	wc := wndClass{Proc: syscall.NewCallback(procedure), Instance: instance, Icon: icon, SmallIcon: smallIcon, Cursor: call("LoadCursorW", 0, 32512), Background: 6, Name: name}
	wc.Size = uint32(unsafe.Sizeof(wc))
	if call("RegisterClassExW", uintptr(unsafe.Pointer(&wc))) == 0 {
		message(0, "无法创建安装窗口。")
		return
	}
	style := uintptr(0x00c80000 | 0x00020000)
	r := rect{Right: int32(px(660)), Bottom: int32(px(410))}
	call("AdjustWindowRectEx", uintptr(unsafe.Pointer(&r)), style, 0, 0)
	width, height := uintptr(r.Right-r.Left), uintptr(r.Bottom-r.Top)
	x := (call("GetSystemMetrics", 0) - width) / 2
	y := (call("GetSystemMetrics", 1) - height) / 2
	window = call("CreateWindowExW", 0, uintptr(unsafe.Pointer(name)), ptr(identity.Product+" 安装程序"), style, x, y, width, height, 0, 0, instance, 0)
	if window == 0 {
		message(0, "无法创建安装窗口。")
		return
	}
	i := control("STATIC", "", 3, 28, 26, 48, 48, 0)
	call("SendMessageW", i, 0x170, icon, 0)
	title := control("STATIC", identity.Product, 0, 92, 26, 530, 38, 0)
	call("SendMessageW", title, 0x30, fonts[1], 1)
	control("STATIC", "版本："+identity.Version, 0, 92, 67, 540, 26, 0)
	control("STATIC", "选择安装位置，完成后即可使用。", 0, 28, 116, 604, 26, 0)
	control("STATIC", "安装位置 (&D)", 0, 28, 164, 600, 26, 0)
	home, _ := os.UserHomeDir()
	location = control("EDIT", filepath.Join(home, identity.Root), 0x00800000|0x10000|0x80, 28, 196, 498, 34, 100)
	call("SendMessageW", location, 0xc5, 0x3, uintptr(8|(8<<16)))
	browseButton = control("BUTTON", "浏览… (&B)", 0x10000, 538, 196, 94, 34, 101)
	control("STATIC", "请选择新目录；已有应用、配置和数据不会被覆盖。", 0, 28, 240, 604, 26, 0)
	status = control("STATIC", "准备就绪。", 0, 28, 283, 604, 25, 0)
	progress = control("msctls_progress32", "", 0, 28, 316, 604, 10, 0)
	cancelButton = control("BUTTON", "关闭", 0x10000, 398, 354, 100, 36, 103)
	startButton = control("BUTTON", "开始安装", 0x10000|1, 510, 354, 122, 36, 102)
	call("SetTimer", window, 1, 100, 0)
	call("ShowWindow", window, 5)
	call("UpdateWindow", window)
	call("SetFocus", startButton)
	var m msg
	for {
		n := call("GetMessageW", uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if n == 0 || int32(n) == -1 {
			break
		}
		if call("IsDialogMessageW", window, uintptr(unsafe.Pointer(&m))) == 0 {
			call("TranslateMessage", uintptr(unsafe.Pointer(&m)))
			call("DispatchMessageW", uintptr(unsafe.Pointer(&m)))
		}
	}
}
