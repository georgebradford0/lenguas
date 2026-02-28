#!/usr/bin/env python3
# /// script
# dependencies = ["Pillow"]
# ///
"""Generate tongue-emoji icons for Lenguas iOS app.

Renders the 😛 emoji using macOS AppKit (via a Swift subprocess) so it uses
Apple's own emoji rendering engine.  Requires Xcode / swift to be installed.
"""

import os, json, subprocess, tempfile
from PIL import Image

BG = (255, 255, 255)   # white background

# Swift renders the emoji at the requested canvas size and writes a PNG.
SWIFT = r"""
import Cocoa

let size   = Int(CommandLine.arguments[1])!
let output = CommandLine.arguments[2]
let W = CGFloat(size)
let H = CGFloat(size)

let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .calibratedRGB, bytesPerRow: 0, bitsPerPixel: 0)!

guard let ctx = NSGraphicsContext(bitmapImageRep: bitmap) else {
    fputs("failed to create NSGraphicsContext\n", stderr); exit(1)
}
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = ctx

NSColor.white.setFill()
NSBezierPath.fill(NSRect(x: 0, y: 0, width: W, height: H))

let font  = NSFont(name: "Apple Color Emoji", size: W * 0.82)
          ?? NSFont.systemFont(ofSize: W * 0.82)
let attrs: [NSAttributedString.Key: Any] = [.font: font]
let str   = NSAttributedString(string: "\u{1F61B}", attributes: attrs)
let sz    = str.size()
str.draw(at: NSPoint(x: (W - sz.width) / 2, y: (H - sz.height) / 2))

NSGraphicsContext.restoreGraphicsState()

let png = bitmap.representation(using: NSBitmapImageRep.FileType.png, properties: [:])!
try! png.write(to: URL(fileURLWithPath: output))
"""

# ── render master via Swift ───────────────────────────────────────────────────
def build_master(canvas=1024):
    swift_f = png_f = None
    try:
        with tempfile.NamedTemporaryFile(suffix='.swift', mode='w',
                                         delete=False, encoding='utf-8') as f:
            f.write(SWIFT)
            swift_f = f.name
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
            png_f = f.name

        print("  Calling swift to render emoji…")
        result = subprocess.run(
            ['swift', swift_f, str(canvas), png_f],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            raise RuntimeError(f"Swift failed:\n{result.stderr}")

        img = Image.open(png_f)
        img.load()
        return img.convert('RGB')
    finally:
        for p in (swift_f, png_f):
            if p and os.path.exists(p):
                os.unlink(p)

# ── all required iOS sizes ────────────────────────────────────────────────────
SIZES = [
    ("Icon-20@1x.png",    20),
    ("Icon-20@2x.png",    40),
    ("Icon-20@3x.png",    60),
    ("Icon-29@1x.png",    29),
    ("Icon-29@2x.png",    58),
    ("Icon-29@3x.png",    87),
    ("Icon-40@1x.png",    40),
    ("Icon-40@2x.png",    80),
    ("Icon-40@3x.png",   120),
    ("Icon-60@2x.png",   120),
    ("Icon-60@3x.png",   180),
    ("Icon-76@1x.png",    76),
    ("Icon-76@2x.png",   152),
    ("Icon-83.5@2x.png", 167),
    ("Icon-1024.png",   1024),
]

CONTENTS = {
  "images": [
    {"filename":"Icon-20@2x.png",  "idiom":"iphone","scale":"2x","size":"20x20"},
    {"filename":"Icon-20@3x.png",  "idiom":"iphone","scale":"3x","size":"20x20"},
    {"filename":"Icon-29@2x.png",  "idiom":"iphone","scale":"2x","size":"29x29"},
    {"filename":"Icon-29@3x.png",  "idiom":"iphone","scale":"3x","size":"29x29"},
    {"filename":"Icon-40@2x.png",  "idiom":"iphone","scale":"2x","size":"40x40"},
    {"filename":"Icon-40@3x.png",  "idiom":"iphone","scale":"3x","size":"40x40"},
    {"filename":"Icon-60@2x.png",  "idiom":"iphone","scale":"2x","size":"60x60"},
    {"filename":"Icon-60@3x.png",  "idiom":"iphone","scale":"3x","size":"60x60"},
    {"filename":"Icon-20@1x.png",  "idiom":"ipad",  "scale":"1x","size":"20x20"},
    {"filename":"Icon-20@2x.png",  "idiom":"ipad",  "scale":"2x","size":"20x20"},
    {"filename":"Icon-29@1x.png",  "idiom":"ipad",  "scale":"1x","size":"29x29"},
    {"filename":"Icon-29@2x.png",  "idiom":"ipad",  "scale":"2x","size":"29x29"},
    {"filename":"Icon-40@1x.png",  "idiom":"ipad",  "scale":"1x","size":"40x40"},
    {"filename":"Icon-40@2x.png",  "idiom":"ipad",  "scale":"2x","size":"40x40"},
    {"filename":"Icon-76@1x.png",  "idiom":"ipad",  "scale":"1x","size":"76x76"},
    {"filename":"Icon-76@2x.png",  "idiom":"ipad",  "scale":"2x","size":"76x76"},
    {"filename":"Icon-83.5@2x.png","idiom":"ipad",  "scale":"2x","size":"83.5x83.5"},
    {"filename":"Icon-1024.png",   "idiom":"ios-marketing","scale":"1x","size":"1024x1024"},
  ],
  "info": {"author": "xcode", "version": 1}
}

def main():
    out = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "mobile", "ios", "Lenguas", "Images.xcassets", "AppIcon.appiconset"
    )
    os.makedirs(out, exist_ok=True)

    print("Building 1024×1024 master…")
    master = build_master()

    for fname, px in SIZES:
        path = os.path.join(out, fname)
        img  = master if px == 1024 else master.resize((px, px), Image.LANCZOS)
        img.save(path, "PNG")
        print(f"  {fname:24s}  {px}×{px}")

    with open(os.path.join(out, "Contents.json"), "w") as f:
        json.dump(CONTENTS, f, indent=2)
    print("  Contents.json")
    print("Done.")

if __name__ == "__main__":
    main()
