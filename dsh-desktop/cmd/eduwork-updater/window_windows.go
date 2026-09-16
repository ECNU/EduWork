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

func applyWithWindow(pending string, pid int) error {
	return runInstallerWindow(readInstallerIdentity(pending), func(report updater.ApplyProgressFunc) error {
		return updater.ApplyPendingWithProgress(pending, pid, report)
	})
}

type installerRect struct{ Left, Top, Right, Bottom int32 }

// This surface must work while Electron and the product runtime are replaced.
// Product icons are loaded into memory before starting the transaction.
func runInstallerWindow(identity installerIdentity, apply func(updater.ApplyProgressFunc) error) error {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	user, gdi := syscall.NewLazyDLL("user32.dll"), syscall.NewLazyDLL("gdi32.dll")
	proc := func(name string) *syscall.LazyProc { return user.NewProc(name) }
	utf := func(s string) *uint16 { p, _ := syscall.UTF16PtrFromString(s); return p }
	if p := proc("SetProcessDpiAwarenessContext"); p.Find() == nil {
		p.Call(^uintptr(3))
	}
	dpi := uintptr(96)
	if p := proc("GetDpiForSystem"); p.Find() == nil {
		if value, _, _ := p.Call(); value > 0 {
			dpi = value
		}
	}
	px := func(value int) int { return (value*int(dpi) + 48) / 96 }
	color := func(r, g, b uintptr) uintptr { return r | g<<8 | b<<16 }
	background, ink, muted := color(246, 248, 251), color(28, 36, 51), color(108, 119, 137)
	blue, border, pale, red := color(65, 108, 239), color(228, 233, 241), color(235, 240, 255), color(177, 46, 66)
	white := color(255, 255, 255)
	brush := func(c uintptr) uintptr { b, _, _ := gdi.NewProc("CreateSolidBrush").Call(c); return b }
	del := func(object uintptr) {
		if object != 0 {
			gdi.NewProc("DeleteObject").Call(object)
		}
	}
	baseBrush := brush(background)
	defer del(baseBrush)
	font := func(size, weight int) uintptr {
		value, _, _ := gdi.NewProc("CreateFontW").Call(uintptr(int64(-px(size))), 0, 0, 0, uintptr(weight), 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(utf("Microsoft YaHei UI"))))
		return value
	}
	headingFont, bodyFont, smallFont, strongFont := font(23, 600), font(14, 400), font(12, 400), font(15, 600)
	defer del(headingFont)
	defer del(bodyFont)
	defer del(smallFont)
	defer del(strongFont)
	loadIcon := func(size int) uintptr {
		if identity.Icon == "" {
			return 0
		}
		value, _, _ := proc("LoadImageW").Call(0, uintptr(unsafe.Pointer(utf(identity.Icon))), 1, uintptr(px(size)), uintptr(px(size)), 0x10)
		return value
	}
	icon, smallIcon := loadIcon(48), loadIcon(20)
	defer proc("DestroyIcon").Call(icon)
	defer proc("DestroyIcon").Call(smallIcon)
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
	type paintStruct struct {
		DC                 uintptr
		Erase              int32
		Rect               installerRect
		Restore, IncUpdate int32
		Reserved           [32]byte
	}
	var mu sync.Mutex
	state := updater.ApplyProgress{Stage: "waiting", Message: "正在等待当前版本安全退出"}
	var result error
	done := false
	var detail, closeButton, copyButton, window uintptr
	clientHeight := 406
	setText := func(handle uintptr, text string) {
		proc("SetWindowTextW").Call(handle, uintptr(unsafe.Pointer(utf(text))))
	}
	drawText := func(dc uintptr, text string, x, y, w, h int, face, c, flags uintptr) {
		r := installerRect{int32(px(x)), int32(px(y)), int32(px(x + w)), int32(px(y + h))}
		previous, _, _ := gdi.NewProc("SelectObject").Call(dc, face)
		gdi.NewProc("SetTextColor").Call(dc, c)
		gdi.NewProc("SetBkMode").Call(dc, 1)
		proc("DrawTextW").Call(dc, uintptr(unsafe.Pointer(utf(text))), ^uintptr(0), uintptr(unsafe.Pointer(&r)), flags|0x800)
		gdi.NewProc("SelectObject").Call(dc, previous)
	}
	roundRect := func(dc uintptr, x, y, w, h, radius int, fill, edge uintptr) {
		b := brush(fill)
		pen, _, _ := gdi.NewProc("CreatePen").Call(0, 1, edge)
		oldB, _, _ := gdi.NewProc("SelectObject").Call(dc, b)
		oldP, _, _ := gdi.NewProc("SelectObject").Call(dc, pen)
		gdi.NewProc("RoundRect").Call(dc, uintptr(px(x)), uintptr(px(y)), uintptr(px(x+w)), uintptr(px(y+h)), uintptr(px(radius)), uintptr(px(radius)))
		gdi.NewProc("SelectObject").Call(dc, oldB)
		gdi.NewProc("SelectObject").Call(dc, oldP)
		del(b)
		del(pen)
	}
	sizeWindow := func(height int) {
		r := installerRect{Right: int32(px(640)), Bottom: int32(px(height))}
		proc("AdjustWindowRectEx").Call(uintptr(unsafe.Pointer(&r)), 0x00CA0000, 0, 0)
		proc("SetWindowPos").Call(window, 0, 0, 0, uintptr(r.Right-r.Left), uintptr(r.Bottom-r.Top), 0x16)
	}
	copyError := func(text string) {
		if ok, _, _ := proc("OpenClipboard").Call(window); ok == 0 {
			return
		}
		defer proc("CloseClipboard").Call()
		content, _ := syscall.UTF16FromString(text)
		kernel := syscall.NewLazyDLL("kernel32.dll")
		handle, _, _ := kernel.NewProc("GlobalAlloc").Call(0x42, uintptr(len(content)*2))
		if handle == 0 {
			return
		}
		memory, _, _ := kernel.NewProc("GlobalLock").Call(handle)
		if memory == 0 {
			kernel.NewProc("GlobalFree").Call(handle)
			return
		}
		copy(unsafe.Slice((*uint16)(unsafe.Pointer(memory)), len(content)), content)
		kernel.NewProc("GlobalUnlock").Call(handle)
		proc("EmptyClipboard").Call()
		if ok, _, _ := proc("SetClipboardData").Call(13, handle); ok == 0 {
			kernel.NewProc("GlobalFree").Call(handle)
		}
	}
	handler := syscall.NewCallback(func(hwnd uintptr, id uint32, w, l uintptr) uintptr {
		switch id {
		case 0x14:
			return 1 // Buffered painting avoids progress flicker.
		case 0xF:
			var ps paintStruct
			dc, _, _ := proc("BeginPaint").Call(hwnd, uintptr(unsafe.Pointer(&ps)))
			defer proc("EndPaint").Call(hwnd, uintptr(unsafe.Pointer(&ps)))
			var rect installerRect
			proc("GetClientRect").Call(hwnd, uintptr(unsafe.Pointer(&rect)))
			buffer, _, _ := gdi.NewProc("CreateCompatibleDC").Call(dc)
			bitmap, _, _ := gdi.NewProc("CreateCompatibleBitmap").Call(dc, uintptr(rect.Right), uintptr(rect.Bottom))
			old, _, _ := gdi.NewProc("SelectObject").Call(buffer, bitmap)
			proc("FillRect").Call(buffer, uintptr(unsafe.Pointer(&rect)), baseBrush)
			mu.Lock()
			progress, finished, err := state, done, result
			mu.Unlock()
			failed := finished && err != nil
			accent := blue
			if failed {
				accent = red
			}
			roundRect(buffer, 22, 22, 596, clientHeight-44, 20, white, border)
			if icon != 0 {
				proc("DrawIconEx").Call(buffer, uintptr(px(48)), uintptr(px(48)), icon, uintptr(px(48)), uintptr(px(48)), 0, 0, 3)
			} else {
				roundRect(buffer, 48, 48, 48, 48, 12, blue, blue)
				drawText(buffer, "E", 48, 48, 48, 48, headingFont, white, 0x25)
			}
			title := "正在更新 " + identity.Name
			if failed {
				title = "更新未完成"
			}
			drawText(buffer, title, 112, 46, 466, 36, headingFont, ink, 0x8024)
			subtitle := "你的配置和历史数据将会保留"
			if identity.Version != "" {
				subtitle = "安装版本 " + identity.Version
			}
			drawText(buffer, subtitle, 112, 83, 466, 22, smallFont, muted, 0x8024)
			stage := installerStage(progress.Stage)
			for i, label := range []string{"检查更新", "安装更新", "启动自检", "完成"} {
				x := 64 + i*158
				if i < 3 {
					roundRect(buffer, x+13, 145, 132, 2, 2, border, border)
				}
				fill, stroke := white, border
				if i <= stage {
					fill = pale
					stroke = accent
				}
				if i < stage {
					fill = accent
				}
				roundRect(buffer, x, 137, 18, 18, 18, fill, stroke)
				textColor := muted
				if i == stage {
					textColor = accent
				}
				drawText(buffer, label, x-36, 165, 90, 24, smallFont, textColor, 0x25)
			}
			head := installerHeading(progress.Stage)
			if failed {
				head = "请检查错误详情后重试"
			}
			drawText(buffer, head, 48, 219, 460, 26, strongFont, ink, 0x8024)
			percent := progress.Percent
			if percent < 0 {
				percent = 0
			}
			if percent > 100 {
				percent = 100
			}
			if !failed {
				drawText(buffer, fmt.Sprintf("%d%%", percent), 524, 219, 66, 26, strongFont, accent, 0x26)
			}
			roundRect(buffer, 48, 261, 544, 7, 7, border, border)
			if percent > 0 {
				width := 544 * percent / 100
				if width < 7 {
					width = 7
				}
				roundRect(buffer, 48, 261, width, 7, 7, accent, accent)
			}
			if !failed {
				drawText(buffer, progress.Message, 48, 281, 544, 28, bodyFont, muted, 0x8024)
				drawText(buffer, "完成后将自动打开应用，请保持此窗口开启。", 48, 340, 544, 24, smallFont, muted, 0x8024)
			} else {
				drawText(buffer, "错误详情", 48, 282, 544, 24, smallFont, muted, 0x8024)
			}
			gdi.NewProc("BitBlt").Call(dc, 0, 0, uintptr(rect.Right), uintptr(rect.Bottom), buffer, 0, 0, 0x00CC0020)
			gdi.NewProc("SelectObject").Call(buffer, old)
			del(bitmap)
			gdi.NewProc("DeleteDC").Call(buffer)
			return 0
		case 0x8010:
			mu.Lock()
			progress, finished, err := state, done, result
			mu.Unlock()
			if finished && err == nil {
				proc("DestroyWindow").Call(hwnd)
				return 0
			}
			if finished && err != nil {
				setText(hwnd, identity.Name+" 更新未完成")
				clientHeight = 560
				sizeWindow(clientHeight)
				setText(detail, err.Error())
				proc("ShowWindow").Call(detail, 5)
				proc("ShowWindow").Call(closeButton, 5)
				proc("ShowWindow").Call(copyButton, 5)
			} else {
				setText(hwnd, fmt.Sprintf("正在更新 %s · %d%%", identity.Name, progress.Percent))
			}
			proc("InvalidateRect").Call(hwnd, 0, 0)
			return 0
		case 0x111:
			mu.Lock()
			finished, err := done, result
			mu.Unlock()
			if finished && w&0xffff == 1 {
				proc("DestroyWindow").Call(hwnd)
			}
			if finished && err != nil && w&0xffff == 2 {
				copyError(err.Error())
			}
			return 0
		case 0x10:
			mu.Lock()
			finished := done
			mu.Unlock()
			if finished {
				proc("DestroyWindow").Call(hwnd)
			}
			return 0 // Never interrupt a transaction.
		case 0x2:
			proc("PostQuitMessage").Call(0)
			return 0
		}
		ret, _, _ := proc("DefWindowProcW").Call(hwnd, uintptr(id), w, l)
		return ret
	})
	instance, _, _ := syscall.NewLazyDLL("kernel32.dll").NewProc("GetModuleHandleW").Call(0)
	cursor, _, _ := proc("LoadCursorW").Call(0, 32512)
	c := class{Procedure: handler, Instance: instance, Icon: icon, SmallIcon: smallIcon, Cursor: cursor, Background: baseBrush, Name: utf("EduWorkPortableInstaller")}
	c.Size = uint32(unsafe.Sizeof(c))
	if ok, _, err := proc("RegisterClassExW").Call(uintptr(unsafe.Pointer(&c))); ok == 0 {
		return fmt.Errorf("create installer window: %w", err)
	}
	defer proc("UnregisterClassW").Call(uintptr(unsafe.Pointer(c.Name)), instance)
	screenW, _, _ := proc("GetSystemMetrics").Call(0)
	screenH, _, _ := proc("GetSystemMetrics").Call(1)
	window, _, _ = proc("CreateWindowExW").Call(0, uintptr(unsafe.Pointer(c.Name)), uintptr(unsafe.Pointer(utf("正在更新 "+identity.Name))), 0x02CA0000, uintptr(int(screenW)/2-px(320)), uintptr(int(screenH)/2-px(225)), uintptr(px(640)), uintptr(px(450)), 0, 0, instance, 0)
	if window == 0 {
		return fmt.Errorf("cannot open installer progress window")
	}
	sizeWindow(clientHeight)
	create := func(kind, text string, style uintptr, x, y, width, height, id int) uintptr {
		h, _, _ := proc("CreateWindowExW").Call(0, uintptr(unsafe.Pointer(utf(kind))), uintptr(unsafe.Pointer(utf(text))), style, uintptr(px(x)), uintptr(px(y)), uintptr(px(width)), uintptr(px(height)), window, uintptr(id), instance, 0)
		proc("SendMessageW").Call(h, 0x30, bodyFont, 1)
		return h
	}
	detail = create("EDIT", "", 0x40A10844, 48, 312, 544, 164, 3) // Read-only multiline text, selectable and scrollable.
	closeButton = create("BUTTON", "关闭", 0x40010000, 492, 492, 100, 34, 1)
	copyButton = create("BUTTON", "复制错误", 0x40010000, 378, 492, 102, 34, 2)
	proc("ShowWindow").Call(window, 1)
	// The parent may use STARTF_USESHOWWINDOW to hide its console. Windows
	// applies that startup hint to the first ShowWindow call; explicitly show
	// our own progress surface afterwards, including for detached helpers.
	proc("ShowWindow").Call(window, 5)
	proc("UpdateWindow").Call(window)
	go func() {
		err := apply(func(p updater.ApplyProgress) {
			mu.Lock()
			if p.Stage != "failed" {
				state = p
			}
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
		if used, _, _ := proc("IsDialogMessageW").Call(window, uintptr(unsafe.Pointer(&m))); used == 0 {
			proc("TranslateMessage").Call(uintptr(unsafe.Pointer(&m)))
			proc("DispatchMessageW").Call(uintptr(unsafe.Pointer(&m)))
		}
	}
	mu.Lock()
	defer mu.Unlock()
	return result
}
