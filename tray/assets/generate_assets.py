"""
generate_assets.py  --  one-time script to produce all tray icon assets.

Run with the backend venv:
    backend\\.venv\\Scripts\\python  tray\\assets\\generate_assets.py

Outputs (all in this directory):
    icon_running.png   256x256  emerald state
    icon_starting.png  256x256  amber state
    icon_stopped.png   256x256  red state
    icon.ico           multi-size (16,24,32,48,256) using running colour
    logo_splash.png    480x160  wide splash banner (dark bg, logo + text)
    logo.svg           vector source for the glyph

Design
------
Rounded-square badge (#0f172a dark slate).
Glyph: two clamp jaws (trapezoidal shapes) pressing inward from top and bottom
toward a central horizontal specimen line; a small triangular force-peak
(waveform apex) at the specimen to indicate tensile data.
Accent colour varies by state (emerald / amber / red).
Small "PMD" label at bottom-right in the accent colour.
Readable at 16px: the jaw outlines are fat enough to resolve.
"""

import math
import os
import sys
from pathlib import Path

# Use Pillow (already in the backend venv via the earlier tray requirements install)
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent

# Colour palette
SLATE_BG   = (15, 23, 42)        # #0f172a
SLATE_RIM  = (30, 41, 59)        # #1e293b  slightly lighter for rim
WHITE      = (248, 250, 252)

EMERALD    = (16, 185, 129)       # #10b981  running
AMBER      = (245, 158, 11)       # #f59e0b  starting
RED        = (239, 68, 68)        # #ef4444  stopped/error


def _make_badge(size: int, accent: tuple) -> Image.Image:
    """Draw the clamp-jaw glyph on a dark rounded-square at *size* x *size*."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    r = size // 6            # corner radius for the badge
    pad = size // 16

    # --- Rounded-square background ---
    draw.rounded_rectangle([pad, pad, size - pad - 1, size - pad - 1],
                            radius=r, fill=SLATE_BG)

    # --- Glyph metrics ---
    cx = size / 2
    cy = size / 2
    jaw_w   = size * 0.50   # jaw width
    jaw_h   = size * 0.18   # jaw face height
    gap     = size * 0.08   # half-gap between jaws (specimen lives here)
    body_h  = size * 0.14   # jaw body (thicker part)
    lw      = max(1, size // 32)   # line width for outlines

    # Top jaw (opens downward; trapezoidal: wide top, narrow bottom)
    tw_top  = jaw_w
    tw_bot  = jaw_w * 0.75
    y_jaw_top_hi = cy - gap - jaw_h - body_h
    y_jaw_top_lo = cy - gap

    top_poly = [
        (cx - tw_top / 2, y_jaw_top_hi),
        (cx + tw_top / 2, y_jaw_top_hi),
        (cx + tw_bot / 2, y_jaw_top_lo),
        (cx - tw_bot / 2, y_jaw_top_lo),
    ]
    draw.polygon(top_poly, fill=accent)
    draw.line(top_poly + [top_poly[0]], fill=WHITE + (40,), width=lw)

    # Bottom jaw (mirror)
    y_jaw_bot_lo = cy + gap + jaw_h + body_h
    y_jaw_bot_hi = cy + gap

    bot_poly = [
        (cx - tw_bot / 2, y_jaw_bot_hi),
        (cx + tw_bot / 2, y_jaw_bot_hi),
        (cx + tw_top / 2, y_jaw_bot_lo),
        (cx - tw_top / 2, y_jaw_bot_lo),
    ]
    draw.polygon(bot_poly, fill=accent)
    draw.line(bot_poly + [bot_poly[0]], fill=WHITE + (40,), width=lw)

    # --- Specimen line (horizontal, between jaws) ---
    spec_x0 = cx - jaw_w * 0.35
    spec_x1 = cx + jaw_w * 0.35
    spec_lw = max(2, size // 20)
    draw.line([(spec_x0, cy), (spec_x1, cy)],
              fill=WHITE, width=spec_lw)

    # --- Force-peak waveform (small triangle at center of specimen) ---
    peak_h  = size * 0.12
    peak_w  = size * 0.14
    peak_poly = [
        (cx - peak_w / 2, cy),
        (cx,              cy - peak_h),
        (cx + peak_w / 2, cy),
    ]
    draw.polygon(peak_poly, fill=WHITE)

    # --- "PMD" micro-label at bottom-right (skip for very small sizes) ---
    if size >= 48:
        font_size = max(8, size // 10)
        try:
            font = ImageFont.truetype("arialbd.ttf", font_size)
        except Exception:
            try:
                font = ImageFont.truetype("arial.ttf", font_size)
            except Exception:
                font = ImageFont.load_default()
        label = "PMD"
        bbox = draw.textbbox((0, 0), label, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        lx = size - pad - tw - 2
        ly = size - pad - th - 2
        draw.text((lx, ly), label, font=font, fill=accent)

    return img


def _make_splash_banner(accent: tuple = EMERALD) -> Image.Image:
    """480x160 dark banner: logo on left, title + subtitle on right."""
    W, H = 480, 160
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background
    draw.rounded_rectangle([0, 0, W - 1, H - 1], radius=16, fill=(15, 23, 42))

    # Logo badge at left
    badge = _make_badge(120, accent)
    img.paste(badge, (20, 20), badge)

    # Title
    title_x = 160
    try:
        font_title = ImageFont.truetype("segoeuib.ttf", 22)
    except Exception:
        try:
            font_title = ImageFont.truetype("arialbd.ttf", 22)
        except Exception:
            font_title = ImageFont.load_default()
    try:
        font_sub = ImageFont.truetype("segoeui.ttf", 13)
    except Exception:
        try:
            font_sub = ImageFont.truetype("arial.ttf", 13)
        except Exception:
            font_sub = ImageFont.load_default()

    draw.text((title_x, 30), "Pinch Test Machine",
              font=font_title, fill=(248, 250, 252))
    draw.text((title_x, 62), "Industrial Control System",
              font=font_sub, fill=(148, 163, 184))

    # Status placeholder (will be updated at runtime via QSplashScreen::showMessage)
    draw.text((title_x, 90), "Starting...",
              font=font_sub, fill=accent)

    return img


def _save_ico(base_img_256: Image.Image, path: Path) -> None:
    """Save multi-size ICO from a 256x256 RGBA image."""
    sizes = [16, 24, 32, 48, 256]
    frames = [base_img_256.resize((s, s), Image.LANCZOS) for s in sizes]
    frames[0].save(
        path, format="ICO", sizes=[(s, s) for s in sizes],
        append_images=frames[1:],
    )


def _make_svg(accent_hex: str = "#10b981") -> str:
    """Return an SVG string of the clamp-jaw glyph (64x64 viewbox)."""
    bg = "#0f172a"
    white = "#f8fafc"
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <!-- Badge background -->
  <rect x="2" y="2" width="60" height="60" rx="10" ry="10" fill="{bg}"/>

  <!-- Top jaw (trapezoid) -->
  <polygon points="10,8 54,8 46,21 18,21" fill="{accent_hex}" opacity="1"/>

  <!-- Bottom jaw (trapezoid, mirrored) -->
  <polygon points="18,43 46,43 54,56 10,56" fill="{accent_hex}" opacity="1"/>

  <!-- Specimen line -->
  <line x1="16" y1="32" x2="48" y2="32" stroke="{white}" stroke-width="3"
        stroke-linecap="round"/>

  <!-- Force peak (waveform triangle) -->
  <polygon points="27,32 32,20 37,32" fill="{white}"/>

  <!-- PMD label -->
  <text x="44" y="59" font-family="Arial,sans-serif" font-size="7"
        font-weight="bold" fill="{accent_hex}" text-anchor="middle">PMD</text>
</svg>"""


def main() -> None:
    print("Generating Pinch Test Machine tray assets ...")

    states = {
        "running":  EMERALD,
        "starting": AMBER,
        "stopped":  RED,
    }

    for state, accent in states.items():
        img256 = _make_badge(256, accent)
        img256.save(HERE / f"icon_{state}.png")
        print(f"  icon_{state}.png  (256x256)")

    # Multi-size ICO uses the running colour
    running256 = _make_badge(256, EMERALD)
    _save_ico(running256, HERE / "icon.ico")
    print("  icon.ico  (16/24/32/48/256)")

    # Splash banner
    splash = _make_splash_banner(EMERALD)
    splash.save(HERE / "logo_splash.png")
    print("  logo_splash.png  (480x160)")

    # SVG source
    svg_text = _make_svg("#10b981")
    (HERE / "logo.svg").write_text(svg_text, encoding="utf-8")
    print("  logo.svg")

    print("Done.")


if __name__ == "__main__":
    main()
