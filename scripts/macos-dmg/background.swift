import AppKit

// Point coordinates match the Finder window and icon positions in package.py.
let width = 780.0, height = 460.0, scale = 2.0
let productName = CommandLine.arguments[2]
let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: Int(width * scale), pixelsHigh: Int(height * scale),
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
NSGraphicsContext.current!.cgContext.scaleBy(x: scale, y: scale)
NSColor(calibratedRed: 0.994, green: 0.984, blue: 0.980, alpha: 1).setFill()
NSRect(x: 0, y: 0, width: width, height: height).fill()
let glow = NSGradient(
    starting: NSColor(calibratedRed: 0.78, green: 0.25, blue: 0.34, alpha: 0.11),
    ending: NSColor(calibratedWhite: 1, alpha: 0)
)!
glow.draw(fromCenter: NSPoint(x: 55, y: 70), radius: 0,
          toCenter: NSPoint(x: 55, y: 70), radius: 410, options: .drawsBeforeStartingLocation)

func text(_ value: String, top: Double, size: Double, weight: NSFont.Weight, gray: Double) {
    let string = value as NSString
    let initialFont = NSFont.systemFont(ofSize: size, weight: weight)
    let measuredWidth = string.size(withAttributes: [.font: initialFont]).width
    let font = NSFont.systemFont(ofSize: size * min(1, 680 / max(1, measuredWidth)), weight: weight)
    let attributes: [NSAttributedString.Key: Any] = [
        .font: font, .foregroundColor: NSColor(calibratedWhite: gray, alpha: 1)
    ]
    let dimensions = string.size(withAttributes: attributes)
    string.draw(at: NSPoint(x: (width - dimensions.width) / 2,
                            y: height - top - dimensions.height), withAttributes: attributes)
}
text("安装 \(productName)", top: 48, size: 34, weight: .semibold, gray: 0.08)
text("拖入应用程序，即可开始", top: 98, size: 17, weight: .regular, gray: 0.47)

NSColor(calibratedRed: 0.64, green: 0.14, blue: 0.22, alpha: 1).setStroke()
let arrow = NSBezierPath()
arrow.lineWidth = 2.5
arrow.lineCapStyle = .round
arrow.move(to: NSPoint(x: 361, y: height - 226))
arrow.line(to: NSPoint(x: 419, y: height - 226))
arrow.move(to: NSPoint(x: 405, y: height - 212))
arrow.line(to: NSPoint(x: 419, y: height - 226))
arrow.line(to: NSPoint(x: 405, y: height - 240))
arrow.stroke()

for index in 0...2 {
    let n = Double(index)
    NSColor(calibratedRed: 0.68, green: 0.2, blue: 0.29, alpha: 0.18 - n * 0.04).setStroke()
    let curve = NSBezierPath()
    curve.lineWidth = 0.6
    curve.move(to: NSPoint(x: 0, y: 60 - n * 12))
    curve.curve(to: NSPoint(x: 780, y: 108 - n * 17),
                controlPoint1: NSPoint(x: 275, y: 35 - n * 26),
                controlPoint2: NSPoint(x: 465, y: -100 - n * 20))
    curve.stroke()
}
NSColor(calibratedWhite: 0.7, alpha: 0.5).setStroke()
let divider = NSBezierPath()
divider.lineWidth = 0.5
divider.move(to: NSPoint(x: 360, y: 88))
divider.line(to: NSPoint(x: 420, y: 88))
divider.stroke()
text("安装完成后，请从「应用程序」中打开", top: 390, size: 12, weight: .regular, gray: 0.44)
NSGraphicsContext.restoreGraphicsState()
bitmap.size = NSSize(width: width, height: height)
try bitmap.representation(using: .png, properties: [:])!
    .write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
