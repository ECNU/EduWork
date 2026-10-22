package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
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
	path     string
	err      error
	warnings []string
}

var results = make(chan outcome, 1)
var scale = 1.0
var backgroundBrush uintptr
var titleLabel uintptr
var desktopOption, launchOption, inputBrush uintptr
var customButton uintptr
var customMode bool
var landingControls, settingsControls []uintptr
var contentPanel uintptr
var feedbackControls []uintptr
var feedbackTitle, feedbackDetail, feedbackHint uintptr
var feedbackMode, confirmTarget string
var animationReady bool
var pageAnimationStart time.Time
var customHovered bool

// COLORREF stores red in the low byte.
const warmBackground = 0xffffff
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
	if d.Window == customButton && (customHovered || call("GetFocus") == customButton) {
		ink = brandRed
	}
	if d.Window == startButton {
		fill, ink = brandRed, 0xffffff
	}
	// Keep keyboard focus visible through color without an inset border.
	if d.State&0x10 != 0 && d.Window != customButton {
		if d.Window == startButton {
			fill = 0x3d2ba9
		} else {
			fill = 0xf4f5f7
		}
	}
	if d.State&4 != 0 {
		fill, ink = 0xe5e5e5, 0x888888
	}
	if d.State&1 != 0 && d.Window == startButton {
		fill = 0x2c1f85
	}
	brush, _, _ := gdi.NewProc("CreateSolidBrush").Call(fill)
	outline := fill
	if d.Window != startButton && d.Window != customButton {
		outline = 0xdde2e8
	}
	pen, _, _ := gdi.NewProc("CreatePen").Call(0, 1, outline)
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
	parent := window
	if contentPanel != 0 {
		parent = contentPanel
	}
	r := call("CreateWindowExW", 0, ptr(class), ptr(title), 0x50000000|style, px(x), px(y), px(w), px(h), parent, uintptr(id), instance, 0)
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
	confirmed := feedbackMode == "confirm"
	if confirmed {
		target = confirmTarget
	}
	if target == "" {
		showFeedback("error", "请选择安装位置", "进入自定义安装，选择应用的安装目录。")
		return
	}
	target, err := filepath.Abs(target)
	if err != nil {
		showFeedback("error", "无法安装到此位置", err.Error())
		return
	}
	text(location, target)
	overwrite := false
	version, err := portable.ExistingInstallation(target, identity)
	if err != nil {
		showFeedback("error", "无法安装到此位置", err.Error())
		return
	}
	if version != "" {
		if !confirmed {
			confirmTarget = target
			showFeedback("confirm", "覆盖安装 EduWork", fmt.Sprintf("已安装版本  %s\n本次安装版本  %s\n\n配置、会话和工作区数据会保留。", version, identity.Version))
			return
		}
		overwrite = true
	}
	busy = true
	showFeedback("installing", "正在安装 EduWork", "正在准备应用，请稍候。")
	enable(customButton, false)
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
		var warnings []string
		path, err := unpackConfirmed(ctx, target, false, overwrite, confirmed, func(p portable.Progress) {
			if p.Warning {
				warnings = append(warnings, p.Message)
				return
			}
			select {
			case updates <- p:
			default:
				// Keep the newest phase when directory batches finish between UI ticks.
				select {
				case <-updates:
				default:
				}
				select {
				case updates <- p:
				default:
				}
			}
		})
		results <- outcome{path: path, err: err, warnings: warnings}
	}()
}
func cancelWork(closeWindow bool) {
	if !busy && feedbackMode == "confirm" && !closeWindow {
		feedbackMode = ""
		customMode = true
		layoutPage()
		return
	}
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
		if p.Message == "正在清理旧版临时备份…" {
			// Replacement has committed; canceling cannot restore a deleted backup.
			enable(cancelButton, false)
		}
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
			enable(customButton, true)
			enable(desktopOption, true)
			enable(launchOption, true)
			enable(location, true)
			enable(browseButton, true)
			enable(startButton, true)
			if r.err == context.Canceled {
				showFeedback("error", "安装已取消", "可以重新选择安装位置后再试。")
			} else {
				showFeedback("error", "安装未完成", r.err.Error())
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
		showFeedback("complete", "安装完成", "EduWork 已准备就绪。\n开始你的下一项工作吧。")
		if len(r.warnings) > 0 {
			text(feedbackHint, "应用已安装，可以正常使用；部分临时文件未能清理。")
			message(window, "EduWork 已安装，可以正常使用。\n\n"+strings.Join(r.warnings, "\n\n"))
		}
		call("SendMessageW", progress, 0x402, 100, 0)
		text(startButton, "立即启动")
		enable(startButton, true)
		text(cancelButton, "完成")
		call("SetFocus", startButton)
		if call("SendMessageW", launchOption, 0xf0, 0, 0) == 1 {
			launchInstalled()
		}
	default:
	}
}
func procedure(h uintptr, m uint32, w, l uintptr) uintptr {
	switch m {
	case 0xf:
		if h != contentPanel {
			return call("DefWindowProcW", h, uintptr(m), w, l)
		}
		var ps struct {
			DC                 uintptr
			Erase              int32
			Paint              rect
			Restore, IncUpdate int32
			Reserved           [32]byte
		}
		dc := call("BeginPaint", h, uintptr(unsafe.Pointer(&ps)))
		if customMode && feedbackMode == "" {
			border := uintptr(0xd4dce6)
			if call("GetFocus") == location {
				border = brandRed
			}
			pen, _, _ := gdi.NewProc("CreatePen").Call(0, px(1), border)
			oldPen, _, _ := gdi.NewProc("SelectObject").Call(dc, pen)
			oldBrush, _, _ := gdi.NewProc("SelectObject").Call(dc, inputBrush)
			gdi.NewProc("RoundRect").Call(dc, px(32), px(156), px(500), px(200), px(14), px(14))
			gdi.NewProc("SelectObject").Call(dc, oldPen)
			gdi.NewProc("SelectObject").Call(dc, oldBrush)
			gdi.NewProc("DeleteObject").Call(pen)
		}
		if customMode && feedbackMode == "" {
			line := rect{Left: int32(px(32)), Top: int32(px(108)), Right: int32(px(608)), Bottom: int32(px(109))}
			brush, _, _ := gdi.NewProc("CreateSolidBrush").Call(0xeff0f2)
			call("FillRect", dc, uintptr(unsafe.Pointer(&line)), brush)
			line.Top, line.Bottom = int32(px(356)), int32(px(357))
			call("FillRect", dc, uintptr(unsafe.Pointer(&line)), brush)
			gdi.NewProc("DeleteObject").Call(brush)
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
				call("InvalidateRect", contentPanel, 0, 0)
			}
		case 104:
			if !busy && !finished {
				if feedbackMode != "" {
					feedbackMode = ""
					customMode = false
				}
				customMode = !customMode
				layoutPage()
				call("SetFocus", customButton)
			}
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
		if w == 2 {
			t := float64(time.Since(pageAnimationStart)) / float64(180*time.Millisecond)
			if t >= 1 {
				t = 1
				call("KillTimer", window, 2)
			}
			remaining := 1 - t
			offset := int(8 * remaining * remaining * remaining)
			call("SetWindowPos", contentPanel, 0, 0, px(offset), px(640), px(430), 0x14)
			return 0
		}
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
	font(12, 400)
	font(22, 600)
	backgroundBrush, _, _ = gdi.NewProc("CreateSolidBrush").Call(warmBackground)
	defer gdi.NewProc("DeleteObject").Call(backgroundBrush)
	defer func() {
		for _, f := range fonts {
			gdi.NewProc("DeleteObject").Call(f)
		}
	}()
	icon := call("LoadImageW", instance, 1, 1, px(44), px(44), 0x8000)
	smallIcon := call("LoadImageW", instance, 1, 1, px(16), px(16), 0x8000)
	name := windows.StringToUTF16Ptr("EduWorkPortableExtractor")
	wc := wndClass{Proc: syscall.NewCallback(procedure), Instance: instance, Icon: icon, SmallIcon: smallIcon, Cursor: call("LoadCursorW", 0, 32512), Background: backgroundBrush, Name: name}
	wc.Size = uint32(unsafe.Sizeof(wc))
	if call("RegisterClassExW", uintptr(unsafe.Pointer(&wc))) == 0 {
		message(0, "无法创建安装窗口。")
		return
	}
	style := uintptr(0x00c80000 | 0x00020000 | 0x02000000)
	r := rect{Right: int32(px(640)), Bottom: int32(px(430))}
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
	panelName := windows.StringToUTF16Ptr("EduWorkInstallerContent")
	panelClass := wndClass{Proc: syscall.NewCallback(panelProcedure), Instance: instance, Cursor: call("LoadCursorW", 0, 32512), Background: backgroundBrush, Name: panelName}
	panelClass.Size = uint32(unsafe.Sizeof(panelClass))
	call("RegisterClassExW", uintptr(unsafe.Pointer(&panelClass)))
	contentPanel = call("CreateWindowExW", 0x10000, uintptr(unsafe.Pointer(panelName)), 0, 0x52000000, 0, 0, px(640), px(430), window, 0, instance, 0)
	// QQ-style landing and custom settings share one fixed-size window.
	largeIcon := call("LoadImageW", instance, 1, 1, px(64), px(64), 0x8000)
	heroIcon := control("STATIC", "", 3, 288, 40, 64, 64, 0)
	call("SendMessageW", heroIcon, 0x170, largeIcon, 0)
	heroTitle := control("STATIC", identity.Product, 1, 100, 124, 440, 44, 0)
	call("SendMessageW", heroTitle, 0x30, fonts[1], 1)
	heroSubtitle := control("STATIC", "让灵感与工作，自然衔接。", 1, 100, 178, 440, 24, 0)
	heroVersion := control("STATIC", "版本 "+identity.Version, 1, 80, 210, 480, 22, 0)
	call("SendMessageW", heroVersion, 0x30, fonts[2], 1)
	landingControls = []uintptr{heroIcon, heroTitle, heroSubtitle, heroVersion}
	i := control("STATIC", "", 3, 32, 28, 44, 44, 0)
	call("SendMessageW", i, 0x170, icon, 0)
	titleLabel = control("STATIC", "安装 "+identity.Product, 0, 92, 24, 516, 32, 0)
	call("SendMessageW", titleLabel, 0x30, fonts[3], 1)
	versionLabel := control("STATIC", "版本 "+identity.Version, 0xc, 92, 60, 516, 22, 0)
	call("SendMessageW", versionLabel, 0x30, fonts[2], 1)
	pathLabel := control("STATIC", "安装位置", 0, 32, 128, 480, 22, 0)
	home, _ := os.UserHomeDir()
	location = control("EDIT", filepath.Join(home, identity.Root), 0x10000|0x80, 46, 168, 440, 22, 100)
	call("SendMessageW", location, 0xc5, 0x3, 0)
	browseButton = control("BUTTON", "更改…", 0x10000|0xb, 516, 156, 92, 44, 101)
	note := control("STATIC", "已有 EduWork 可确认覆盖安装，配置和数据会保留。", 0, 32, 210, 576, 24, 0)
	desktopOption = control("BUTTON", "创建桌面快捷方式", 0x10000|0x3, 32, 252, 280, 26, 105)
	launchOption = control("BUTTON", "安装完成后立即启动", 0x10000|0x3, 32, 288, 280, 26, 106)
	call("SendMessageW", desktopOption, 0xf1, 1, 0)
	settingsControls = []uintptr{i, titleLabel, versionLabel, pathLabel, location, browseButton, note, desktopOption, launchOption}
	feedbackIcon := control("STATIC", "", 3, 32, 28, 44, 44, 0)
	call("SendMessageW", feedbackIcon, 0x170, icon, 0)
	feedbackTitle = control("STATIC", "", 0, 32, 116, 576, 40, 0)
	call("SendMessageW", feedbackTitle, 0x30, fonts[3], 1)
	feedbackDetail = control("STATIC", "", 0, 32, 174, 576, 116, 0)
	feedbackHint = control("STATIC", "", 0, 32, 304, 576, 42, 0)
	call("SendMessageW", feedbackHint, 0x30, fonts[2], 1)
	feedbackControls = []uintptr{feedbackIcon, feedbackTitle, feedbackDetail, feedbackHint}
	status = control("STATIC", "", 0, 32, 382, 270, 24, 0)
	progress = control("msctls_progress32", "", 0, 32, 338, 576, 4, 0)
	windows.NewLazySystemDLL("uxtheme.dll").NewProc("SetWindowTheme").Call(progress, ptr(" "), ptr(" "))
	call("SendMessageW", progress, 0x409, 0, brandRed)
	call("SendMessageW", progress, 0x2001, 0, 0xe0e4ee)
	call("ShowWindow", progress, 0)
	cancelButton = control("BUTTON", "取消", 0x10000|0xb, 320, 372, 100, 40, 103)
	startButton = control("BUTTON", "立即安装", 0x10000|0xb, 210, 264, 220, 44, 102)
	customButton = control("BUTTON", "自定义安装  ›", 0x10000|0xb, 240, 316, 160, 32, 104)
	// Replace the native dotted label outline with a small solid focus marker.
	for _, c := range []uintptr{desktopOption, launchOption} {
		windows.NewLazySystemDLL("comctl32.dll").NewProc("SetWindowSubclass").Call(c, syscall.NewCallback(checkFocusProcedure), 1, 0)
	}
	windows.NewLazySystemDLL("comctl32.dll").NewProc("SetWindowSubclass").Call(customButton, syscall.NewCallback(linkProcedure), 2, 0)
	layoutPage()
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

func showFeedback(mode, title, detail string) {
	feedbackMode = mode
	text(feedbackTitle, title)
	text(feedbackDetail, detail)
	text(feedbackHint, "")
	if mode == "confirm" {
		text(feedbackHint, "先尝试正常退出，未退出的进程将强制结束；未保存内容可能丢失。更新进行中请等待完成。")
	}
	if mode == "error" {
		text(feedbackHint, "调整安装选项后可重新尝试。")
	}
	layoutPage()
}
func layoutPage() {
	call("SendMessageW", contentPanel, 0xb, 0, 0)
	call("ShowWindow", contentPanel, 0)
	for _, c := range landingControls {
		n := uintptr(0)
		if !customMode && feedbackMode == "" {
			n = 5
		}
		call("ShowWindow", c, n)
	}
	for _, c := range settingsControls {
		n := uintptr(0)
		if customMode && feedbackMode == "" {
			n = 5
		}
		call("ShowWindow", c, n)
	}
	for _, c := range feedbackControls {
		n := uintptr(0)
		if feedbackMode != "" {
			n = 5
		}
		call("ShowWindow", c, n)
	}
	call("ShowWindow", progress, 0)
	call("ShowWindow", startButton, 5)
	call("ShowWindow", customButton, 5)
	call("ShowWindow", status, 5)
	call("ShowWindow", cancelButton, 5)
	call("SetWindowPos", status, 0, px(32), px(316), px(576), px(24), 0x14)
	call("SetWindowPos", progress, 0, px(32), px(348), px(576), px(4), 0x14)
	call("SetWindowPos", startButton, 0, px(408), px(372), px(200), px(40), 0x14)
	call("SetWindowPos", cancelButton, 0, px(292), px(372), px(100), px(40), 0x14)
	call("SetWindowPos", customButton, 0, px(32), px(372), px(180), px(40), 0x14)
	text(startButton, "立即安装")
	text(cancelButton, "取消")
	if feedbackMode != "" {
		call("ShowWindow", status, 0)
		text(customButton, "修改安装选项  ›")
		switch feedbackMode {
		case "confirm":
			text(startButton, "关闭应用并覆盖安装")
			call("ShowWindow", customButton, 0)
		case "error":
			text(startButton, "重试")
			text(cancelButton, "关闭")
		case "complete":
			text(startButton, "立即启动")
			text(cancelButton, "完成")
			call("ShowWindow", customButton, 0)
		case "installing":
			call("ShowWindow", customButton, 0)
			call("ShowWindow", startButton, 0)
			call("ShowWindow", status, 5)
			call("ShowWindow", progress, 5)
			text(feedbackDetail, "安装完成前请保持此窗口打开。")
			text(cancelButton, "取消安装")
			call("SetWindowPos", cancelButton, 0, px(508), px(372), px(100), px(40), 0x14)
		}
	} else if customMode {
		text(customButton, "‹ 返回")
		text(status, "")
		call("ShowWindow", status, 0)
	} else {
		text(customButton, "自定义安装  ›")
		text(status, "安装到 "+readText(location))
		call("SetWindowPos", customButton, 0, px(240), px(316), px(160), px(32), 0x14)
		call("SetWindowPos", startButton, 0, px(210), px(264), px(220), px(44), 0x14)
		call("SetWindowPos", status, 0, px(32), px(370), px(576), px(24), 0x14)
		call("ShowWindow", cancelButton, 0)
	}
	call("SendMessageW", contentPanel, 0xb, 1, 0)
	call("RedrawWindow", contentPanel, 0, 0, 0x185)
	var animate int32
	call("SystemParametersInfoW", 0x1042, 0, uintptr(unsafe.Pointer(&animate)), 0)
	call("KillTimer", window, 2)
	if animationReady && animate != 0 {
		pageAnimationStart = time.Now()
		call("SetWindowPos", contentPanel, 0, 0, px(8), px(640), px(430), 0x14)
		call("ShowWindow", contentPanel, 5)
		call("SetTimer", window, 2, 15, 0)
	} else {
		call("SetWindowPos", contentPanel, 0, 0, 0, px(640), px(430), 0x14)
		call("ShowWindow", contentPanel, 5)
	}
	animationReady = true
}
func panelProcedure(h uintptr, m uint32, w, l uintptr) uintptr {
	switch m {
	case 0xf, 0x111, 0x2b, 0x133, 0x135, 0x138:
		return procedure(h, m, w, l)
	}
	return call("DefWindowProcW", h, uintptr(m), w, l)
}
func checkFocusProcedure(h uintptr, m uint32, w, l, id, data uintptr) uintptr {
	proc := windows.NewLazySystemDLL("comctl32.dll").NewProc("DefSubclassProc")
	if m == 0x128 {
		w = 0x10001
	}
	r, _, _ := proc.Call(h, uintptr(m), w, l)
	if m == 0x7 {
		call("SendMessageW", h, 0x128, 0x10001, 0)
	}
	if m == 0x8 {
		call("InvalidateRect", h, 0, 1)
	}
	if m == 0xf && call("GetFocus") == h {
		dc := call("GetDC", h)
		line := rect{Left: int32(px(24)), Top: int32(px(24)), Right: int32(px(40)), Bottom: int32(px(26))}
		brush, _, _ := gdi.NewProc("CreateSolidBrush").Call(brandRed)
		call("FillRect", dc, uintptr(unsafe.Pointer(&line)), brush)
		gdi.NewProc("DeleteObject").Call(brush)
		call("ReleaseDC", h, dc)
	}
	return r
}

func linkProcedure(h uintptr, m uint32, w, l, id, data uintptr) uintptr {
	switch m {
	case 0x20:
		call("SetCursor", call("LoadCursorW", 0, 32649))
		return 1
	case 0x200:
		if !customHovered {
			customHovered = true
			call("InvalidateRect", h, 0, 1)
		}
		track := struct {
			Size, Flags uint32
			Window      uintptr
			Hover       uint32
		}{Flags: 2, Window: h}
		track.Size = uint32(unsafe.Sizeof(track))
		call("TrackMouseEvent", uintptr(unsafe.Pointer(&track)))
	case 0x2a3:
		customHovered = false
		call("InvalidateRect", h, 0, 1)
	case 0x7, 0x8:
		call("InvalidateRect", h, 0, 1)
	}
	r, _, _ := windows.NewLazySystemDLL("comctl32.dll").NewProc("DefSubclassProc").Call(h, uintptr(m), w, l)
	return r
}
