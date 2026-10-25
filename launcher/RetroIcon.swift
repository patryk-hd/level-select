import AppKit

// Draws the Level Select icon: output.icns for the Mac app, or output.ico for Windows
// (launcher/windows/LevelSelect.ico, kept in the repository: Windows builds can't run Swift).
guard CommandLine.arguments.count == 2 else {
    fputs("Usage: RetroIcon.swift output.icns|output.ico\n", stderr)
    exit(2)
}

func renderIcon(pixels: Int) -> Data {
    let size = CGFloat(pixels)
    // Drawn into a bitmap of exactly this many pixels (an NSImage would double them on a
    // Retina screen).
    guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4,
                                        hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else {
        fatalError("Could not render the Level Select icon at \(pixels) pixels.")
    }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)

    let rect = NSRect(x: 0, y: 0, width: size, height: size)
    let background = NSBezierPath(
        roundedRect: rect.insetBy(dx: size * 0.055, dy: size * 0.055),
        xRadius: size * 0.23,
        yRadius: size * 0.23
    )
    NSColor(calibratedRed: 228/255, green: 183/255, blue: 112/255, alpha: 1).setFill()
    background.fill()

    let font = NSFont.systemFont(ofSize: size * 0.56, weight: .bold)
    let text = "L" as NSString
    let attributes: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: NSColor(calibratedRed: 20/255, green: 22/255, blue: 25/255, alpha: 1)
    ]
    let textSize = text.size(withAttributes: attributes)
    text.draw(
        at: NSPoint(x: (size - textSize.width) / 2, y: (size - textSize.height) / 2 + size * 0.024),
        withAttributes: attributes
    )

    NSGraphicsContext.restoreGraphicsState()

    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        fatalError("Could not render the Level Select icon at \(pixels) pixels.")
    }
    return png
}

func appendFourCC(_ value: String, to data: inout Data) {
    data.append(value.data(using: .ascii)!)
}

func appendUInt32(_ value: Int, to data: inout Data) {
    var bigEndian = UInt32(value).bigEndian
    withUnsafeBytes(of: &bigEndian) { data.append(contentsOf: $0) }
}

func appendUInt16LE(_ value: Int, to data: inout Data) {
    var little = UInt16(value).littleEndian
    withUnsafeBytes(of: &little) { data.append(contentsOf: $0) }
}

func appendUInt32LE(_ value: Int, to data: inout Data) {
    var little = UInt32(value).littleEndian
    withUnsafeBytes(of: &little) { data.append(contentsOf: $0) }
}

// Windows icons: a directory of PNG images (Windows Vista and later read PNG entries).
if CommandLine.arguments[1].lowercased().hasSuffix(".ico") {
    let sizes = [16, 24, 32, 48, 64, 128, 256], images = sizes.map { renderIcon(pixels: $0) }
    var ico = Data()
    appendUInt16LE(0, to: &ico); appendUInt16LE(1, to: &ico); appendUInt16LE(sizes.count, to: &ico)
    var offset = 6 + 16 * sizes.count
    for (pixels, png) in zip(sizes, images) {
        ico.append(UInt8(pixels >= 256 ? 0 : pixels)); ico.append(UInt8(pixels >= 256 ? 0 : pixels))
        ico.append(0); ico.append(0)
        appendUInt16LE(1, to: &ico); appendUInt16LE(32, to: &ico)
        appendUInt32LE(png.count, to: &ico); appendUInt32LE(offset, to: &ico)
        offset += png.count
    }
    images.forEach { ico.append($0) }
    try ico.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
    exit(0)
}

let representations: [(String, Int)] = [
    ("icp4", 16),
    ("icp5", 32),
    ("icp6", 64),
    ("ic07", 128),
    ("ic08", 256),
    ("ic09", 512),
    ("ic10", 1024),
    ("ic11", 32),
    ("ic12", 64),
    ("ic13", 256),
    ("ic14", 512)
]

var chunks = Data()
for (type, pixels) in representations {
    let png = renderIcon(pixels: pixels)
    appendFourCC(type, to: &chunks)
    appendUInt32(png.count + 8, to: &chunks)
    chunks.append(png)
}

var icon = Data()
appendFourCC("icns", to: &icon)
appendUInt32(chunks.count + 8, to: &icon)
icon.append(chunks)

try icon.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
