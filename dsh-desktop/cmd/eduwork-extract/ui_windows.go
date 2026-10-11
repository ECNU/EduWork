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
var backgroundBrush uintptr
var optionControls []uintptr
var optionsButton uintptr
var optionsOpen bool
var titleLabel uintptr
var desktopOption, launchOption, inputBrush uintptr

func layoutOptions() {
	show := uintptr(0)
	label, offset := "安装选项  ﹀", 0
	if optionsOpen {
		show = 5
		label = "收起选项  ﹀"
		offset = 116
	}
	for _, c := range optionControls {
		call("ShowWindow", c, show)
	}
	text(optionsButton, label)
	call("SetWindowPos", status, 0, px(40), px(378+offset), px(480), px(26), 0x14)
	call("SetWindowPos", progress, 0, px(40), px(412+offset), px(480), px(6), 0x14)
	r := rect{Right: int32(px(560)), Bottom: int32(px(444 + offset))}
	call("AdjustWindowRectEx", uintptr(unsafe.Pointer(&r)), 0x00ca0000, 0, 0)
	call("SetWindowPos", window, 0, 0, 0, uintptr(r.Right-r.Left), uintptr(r.Bottom-r.Top), 0x16)
	call("InvalidateRect", window, 0, 1)
}

// COLORREF stores red in the low byte.
const warmBackground = 0xeff3fa
const brandRed = 0x36269f

type drawItem struct {
	ControlType, ControlID, ItemID, Action, State uint32
	Window, DC                                    uintptr
	Bounds                                        rect
	Data                                          uintptr
}

func paintButton(l uintptr) {
	var item drawItem
	windows.NewLazySystemDLL("kernel32.dll").NewProc("RtlMoveMemory").Call(uintptr(unsafe.Pointer(&item)), l, unsafe.Sizeof(item))
	d := &item
	fill, ink := uintptr(0xffffff), uintptr(0x635951)
	if d.Window == startButton {
		fill, ink = brandRed, 0xffffff
	}
	if d.State&4 != 0 {
		fill, ink = 0xe5e5e5, 0x888888
	}
	if d.State&1 != 0 && d.Window == startButton {
		fill = 0x2c1f85
	}
	brush, _, _ := gdi.NewProc("CreateSolidBrush").Call(fill)
	pen, _, _ := gdi.NewProc("CreatePen").Call(0, 1, fill)
	oldBrush, _, _ := gdi.NewProc("SelectObject").Call(d.DC, brush)
	oldPen, _, _ := gdi.NewProc("SelectObject").Call(d.DC, pen)
	gdi.NewProc("RoundRect").Call(d.DC, uintptr(d.Bounds.Left), uintptr(d.Bounds.Top), uintptr(d.Bounds.Right), uintptr(d.Bounds.Bottom), px(14), px(14))
	gdi.NewProc("SelectObject").Call(d.DC, oldBrush)
	gdi.NewProc("SelectObject").Call(d.DC, oldPen)
	gdi.NewProc("DeleteObject").Call(brush)
	gdi.NewProc("DeleteObject").Call(pen)
	gdi.NewProc("SetTextColor").Call(d.DC, ink)
	gdi.NewProc("SetBkMode").Call(d.DC, 1)
	oldFont, _, _ := gdi.NewProc("SelectObject").Call(d.DC, fonts[0])
	call("DrawTextW", d.DC, ptr(readText(d.Window)), ^uintptr(0), uintptr(unsafe.Pointer(&d.Bounds)), 0x25)
	gdi.NewProc("SelectObject").Call(d.DC, oldFont)
	if d.State&0x10 != 0 {
		r := d.Bounds
		r.Left += 5
		r.Top += 5
		r.Right -= 5
		r.Bottom -= 5
		call("DrawFocusRect", d.DC, uintptr(unsafe.Pointer(&r)))
	}
}

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
	h, _, _ := gdi.NewProc("CreateFontW").Call(uintptr(int32(-int(float64(size)*scale))), 0, 0, 0, uintptr(weight), 0, 0, 0, 1, 0, 0, 5, 0, ptr("Microsoft YaHei UI"))
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
	enable(optionsButton, false)
	enable(desktopOption, false)
	enable(launchOption, false)
	call("ShowWindow", progress, 5)
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
			enable(optionsButton, true)
			enable(desktopOption, true)
			enable(launchOption, true)
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
		if call("SendMessageW", desktopOption, 0xf0, 0, 0) == 1 {
			if err := createDesktopShortcut(installed); err != nil {
				message(window, fmt.Sprintf("应用已安装，但桌面快捷方式创建失败。\n\n%s", err))
			}
		}
		if call("SendMessageW", launchOption, 0xf0, 0, 0) == 1 {
			launchInstalled()
			return
		}
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
	case 0xf:
		var ps struct {
			DC                 uintptr
			Erase              int32
			Paint              rect
			Restore, IncUpdate int32
			Reserved           [32]byte
		}
		dc := call("BeginPaint", h, uintptr(unsafe.Pointer(&ps)))
		if optionsOpen {
			border := uintptr(0xd4dce6)
			if call("GetFocus") == location {
				border = brandRed
			}
			pen, _, _ := gdi.NewProc("CreatePen").Call(0, px(1), border)
			oldPen, _, _ := gdi.NewProc("SelectObject").Call(dc, pen)
			oldBrush, _, _ := gdi.NewProc("SelectObject").Call(dc, inputBrush)
			gdi.NewProc("RoundRect").Call(dc, px(40), px(394), px(424), px(438), px(14), px(14))
			gdi.NewProc("SelectObject").Call(dc, oldPen)
			gdi.NewProc("SelectObject").Call(dc, oldBrush)
			gdi.NewProc("DeleteObject").Call(pen)
		}
		call("EndPaint", h, uintptr(unsafe.Pointer(&ps)))
		return 0
	case 0x133:
		gdi.NewProc("SetBkColor").Call(w, 0xffffff)
		gdi.NewProc("SetTextColor").Call(w, 0x181a24)
		return inputBrush
	case 0x2b:
		paintButton(l)
		return 1
	case 0x135, 0x138: // Match native static labels to the window background.
		gdi.NewProc("SetBkMode").Call(w, 1)
		ink := uintptr(0x635951)
		if l == titleLabel {
			ink = 0x181a24
		}
		gdi.NewProc("SetTextColor").Call(w, ink)
		return backgroundBrush
	case 0x111:
		switch w & 0xffff {
		case 100:
			if w>>16 == 0x100 || w>>16 == 0x200 {
				call("InvalidateRect", window, 0, 0)
			}
		case 104:
			if busy || finished {
				return 0
			}
			optionsOpen = !optionsOpen
			layoutOptions()
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
				launchInstalled()
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
	font(14, 400)
	inputBrush, _, _ = gdi.NewProc("CreateSolidBrush").Call(0xffffff)
	defer gdi.NewProc("DeleteObject").Call(inputBrush)
	font(28, 600)
	backgroundBrush, _, _ = gdi.NewProc("CreateSolidBrush").Call(warmBackground)
	defer gdi.NewProc("DeleteObject").Call(backgroundBrush)
	defer func() {
		for _, f := range fonts {
			gdi.NewProc("DeleteObject").Call(f)
		}
	}()
	icon := call("LoadImageW", instance, 1, 1, px(48), px(48), 0x8000)
	smallIcon := call("LoadImageW", instance, 1, 1, px(16), px(16), 0x8000)
	name := windows.StringToUTF16Ptr("EduWorkPortableExtractor")
	wc := wndClass{Proc: syscall.NewCallback(procedure), Instance: instance, Icon: icon, SmallIcon: smallIcon, Cursor: call("LoadCursorW", 0, 32512), Background: backgroundBrush, Name: name}
	wc.Size = uint32(unsafe.Sizeof(wc))
	if call("RegisterClassExW", uintptr(unsafe.Pointer(&wc))) == 0 {
		message(0, "无法创建安装窗口。")
		return
	}
	style := uintptr(0x00c80000 | 0x00020000 | 0x02000000)
	r := rect{Right: int32(px(560)), Bottom: int32(px(444))}
	call("AdjustWindowRectEx", uintptr(unsafe.Pointer(&r)), style, 0, 0)
	width, height := uintptr(r.Right-r.Left), uintptr(r.Bottom-r.Top)
	x := (call("GetSystemMetrics", 0) - width) / 2
	y := (call("GetSystemMetrics", 1) - height) / 2
	window = call("CreateWindowExW", 0, uintptr(unsafe.Pointer(name)), ptr(identity.Product+" 安装程序"), style, x, y, width, height, 0, 0, instance, 0)
	if window == 0 {
		message(0, "无法创建安装窗口。")
		return
	}
	// Windows 11 honors these attributes; older Windows keeps native chrome.
	dwm := windows.NewLazySystemDLL("dwmapi.dll")
	caption, corners := uint32(warmBackground), uint32(2)
	dwm.NewProc("DwmSetWindowAttribute").Call(window, 35, uintptr(unsafe.Pointer(&caption)), 4)
	dwm.NewProc("DwmSetWindowAttribute").Call(window, 33, uintptr(unsafe.Pointer(&corners)), 4)
	i := control("STATIC", "", 3, 40, 34, 48, 48, 0)
	call("SendMessageW", i, 0x170, icon, 0)
	title := control("STATIC", "安装 "+identity.Product, 0, 40, 102, 480, 44, 0)
	titleLabel = title
	call("SendMessageW", title, 0x30, fonts[1], 1)
	control("STATIC", "准备好，开始高效工作。", 0, 40, 154, 480, 26, 0)
	control("STATIC", "版本 "+identity.Version, 0, 104, 48, 416, 24, 0)
	pathLabel := control("STATIC", "安装位置 (&D)", 0, 40, 366, 480, 22, 0)
	home, _ := os.UserHomeDir()
	location = control("EDIT", filepath.Join(home, identity.Root), 0x10000|0x80, 54, 406, 356, 22, 100)
	call("SendMessageW", location, 0xc5, 0x3, 0)
	browseButton = control("BUTTON", "浏览… (&B)", 0x10000|0xb, 436, 394, 84, 44, 101)
	note := control("STATIC", "请选择新目录，已有配置和数据不会被覆盖。", 0, 40, 450, 480, 24, 0)
	optionControls = []uintptr{pathLabel, location, browseButton, note}
	for _, c := range optionControls {
		call("ShowWindow", c, 0)
	}
	desktopOption = control("BUTTON", "创建桌面快捷方式", 0x10000|0x3, 40, 294, 240, 28, 105)
	launchOption = control("BUTTON", "安装完成后立即启动", 0x10000|0x3, 288, 294, 232, 28, 106)
	call("SendMessageW", desktopOption, 0xf1, 1, 0)
	optionsButton = control("BUTTON", "安装选项  ﹀", 0x10000|0xb, 40, 254, 132, 32, 104)
	status = control("STATIC", "安装完成后即可使用", 0, 40, 374, 480, 26, 0)
	progress = control("msctls_progress32", "", 0, 40, 408, 480, 6, 0)
	windows.NewLazySystemDLL("uxtheme.dll").NewProc("SetWindowTheme").Call(progress, ptr(" "), ptr(" "))
	call("SendMessageW", progress, 0x409, 0, brandRed)
	call("SendMessageW", progress, 0x2001, 0, 0xe0e4ee)
	call("ShowWindow", progress, 0)
	cancelButton = control("BUTTON", "关闭", 0x10000|0xb, 440, 202, 80, 44, 103)
	startButton = control("BUTTON", "立即安装", 0x10000|0xb, 40, 202, 300, 44, 102)
	layoutOptions()
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

func launchInstalled() {
	cmd := exec.Command(filepath.Join(installed, "EduWork-Electron.exe"))
	cmd.Dir = installed
	if err := cmd.Start(); err != nil {
		message(window, fmt.Sprintf("应用已安装，但启动失败。请在应用目录中手动启动。\n\n%s", err))
	} else {
		_ = cmd.Process.Release()
		call("DestroyWindow", window)
	}
}
