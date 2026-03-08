#!/usr/bin/env python3
# /// script
# dependencies = ["Pillow"]
# ///
"""Generate tongue-emoji icons for Lenguas Android app.

Renders the 😛 emoji using macOS AppKit (via a Swift subprocess) so it uses
Apple's own emoji rendering engine.  Requires Xcode / swift to be installed.

Generates:
  - Legacy ic_launcher.png and ic_launcher_round.png for each mipmap density
  - Adaptive icon foreground (ic_launcher_foreground.png) per density
  - mipmap-anydpi-v26/ic_launcher.xml and ic_launcher_round.xml
  - Play Store icon: ic_launcher_playstore.png (512x512)
"""

import os, subprocess, tempfile
from PIL import Image, ImageDraw

BG_COLOR = (99, 102, 241)   # indigo — matches app primary color

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

// Transparent background — composite over colour in Python
NSColor.clear.setFill()
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


def render_emoji(canvas: int) -> Image.Image:
    """Render the emoji at `canvas` px with a transparent background."""
    swift_f = png_f = None
    try:
        with tempfile.NamedTemporaryFile(suffix='.swift', mode='w',
                                         delete=False, encoding='utf-8') as f:
            f.write(SWIFT)
            swift_f = f.name
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
            png_f = f.name

        result = subprocess.run(
            ['swift', swift_f, str(canvas), png_f],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            raise RuntimeError(f"Swift failed:\n{result.stderr}")

        img = Image.open(png_f)
        img.load()
        return img.convert('RGBA')
    finally:
        for p in (swift_f, png_f):
            if p and os.path.exists(p):
                os.unlink(p)


def make_square_icon(emoji: Image.Image, size: int) -> Image.Image:
    """Emoji on solid rounded-square background, resized to `size`."""
    canvas = emoji.width
    bg = Image.new('RGBA', (canvas, canvas), (*BG_COLOR, 255))
    bg.paste(emoji, (0, 0), emoji)
    return bg.resize((size, size), Image.LANCZOS).convert('RGB')


def make_round_icon(emoji: Image.Image, size: int) -> Image.Image:
    """Emoji on a circular background, resized to `size`."""
    canvas = emoji.width
    bg = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
    mask = Image.new('L', (canvas, canvas), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, canvas, canvas), fill=255)
    color_layer = Image.new('RGBA', (canvas, canvas), (*BG_COLOR, 255))
    bg.paste(color_layer, mask=mask)
    bg.paste(emoji, (0, 0), emoji)
    out = bg.resize((size, size), Image.LANCZOS)
    # Apply circular mask at final size
    final_mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(final_mask).ellipse((0, 0, size, size), fill=255)
    result = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    result.paste(out, mask=final_mask)
    return result


def make_foreground(emoji: Image.Image, size: int) -> Image.Image:
    """
    Adaptive icon foreground: emoji centred in a 108dp canvas (safe zone = 72dp).
    The emoji fills ~72/108 = 66% of the canvas so it stays within the safe zone.
    Background is transparent.
    """
    canvas = emoji.width
    # Scale emoji to 66% of output canvas
    emoji_size = int(size * 0.66)
    offset = (size - emoji_size) // 2
    emoji_resized = emoji.resize((emoji_size, emoji_size), Image.LANCZOS)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(emoji_resized, (offset, offset), emoji_resized)
    return out


# Legacy mipmap sizes: (density, px)
LEGACY_SIZES = [
    ('mipmap-mdpi',    48),
    ('mipmap-hdpi',    72),
    ('mipmap-xhdpi',   96),
    ('mipmap-xxhdpi',  144),
    ('mipmap-xxxhdpi', 192),
]

# Adaptive foreground sizes (108dp at each density)
ADAPTIVE_SIZES = [
    ('mipmap-mdpi',    108),
    ('mipmap-hdpi',    162),
    ('mipmap-xhdpi',   216),
    ('mipmap-xxhdpi',  324),
    ('mipmap-xxxhdpi', 432),
]

# Adaptive icon XML (solid colour background defined in XML, transparent foreground PNG)
ADAPTIVE_XML = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
"""

COLORS_XML = """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#6366F1</color>
</resources>
"""


def main():
    res_dir = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        'mobile', 'android', 'app', 'src', 'main', 'res'
    )

    print("Rendering 1024×1024 emoji master…")
    emoji = render_emoji(1024)

    # ── Legacy icons ─────────────────────────────────────────────────────────
    print("\nLegacy icons:")
    for density, px in LEGACY_SIZES:
        d = os.path.join(res_dir, density)
        os.makedirs(d, exist_ok=True)

        square = make_square_icon(emoji, px)
        square.save(os.path.join(d, 'ic_launcher.png'), 'PNG')

        rnd = make_round_icon(emoji, px)
        rnd.save(os.path.join(d, 'ic_launcher_round.png'), 'PNG')
        print(f"  {density:22s}  {px}×{px}")

    # ── Adaptive foreground PNGs ──────────────────────────────────────────────
    print("\nAdaptive foreground:")
    for density, px in ADAPTIVE_SIZES:
        d = os.path.join(res_dir, density)
        os.makedirs(d, exist_ok=True)
        fg = make_foreground(emoji, px)
        fg.save(os.path.join(d, 'ic_launcher_foreground.png'), 'PNG')
        print(f"  {density:22s}  {px}×{px}")

    # ── Adaptive icon XML ─────────────────────────────────────────────────────
    anydpi_dir = os.path.join(res_dir, 'mipmap-anydpi-v26')
    os.makedirs(anydpi_dir, exist_ok=True)
    for name in ('ic_launcher.xml', 'ic_launcher_round.xml'):
        with open(os.path.join(anydpi_dir, name), 'w') as f:
            f.write(ADAPTIVE_XML)
    print(f"\n  mipmap-anydpi-v26/ic_launcher.xml")
    print(f"  mipmap-anydpi-v26/ic_launcher_round.xml")

    # ── Background colour resource ────────────────────────────────────────────
    values_dir = os.path.join(res_dir, 'values')
    os.makedirs(values_dir, exist_ok=True)
    colors_path = os.path.join(values_dir, 'ic_launcher_background.xml')
    with open(colors_path, 'w') as f:
        f.write(COLORS_XML)
    print(f"  values/ic_launcher_background.xml")

    # ── Play Store icon ───────────────────────────────────────────────────────
    playstore_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        'mobile', 'android', 'app', 'ic_launcher_playstore.png'
    )
    make_square_icon(emoji, 512).save(playstore_path, 'PNG')
    print(f"\nPlay Store icon: android/app/ic_launcher_playstore.png  512×512")
    print("\nDone.")


if __name__ == '__main__':
    main()
