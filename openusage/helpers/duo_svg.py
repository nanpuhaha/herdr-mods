#!/usr/bin/env python3
"""
Status-Trio Style Inverted Dual Arc Gauge Generator for OpenUsage.
Design Architecture:
- Upper Short Arc (5h / 24h percentage):
  Shorter duration (5 hours) represented by shorter wings flanking the top percentage:
  - Left wing: 215° to 245° (span 30°)
  - Top gap: 245° to 295° (span 50°) for top 5h/24h % text
  - Right wing: 295° to 325° (span 30°)
  - Fills 0%~50% on left wing, 50%~100% on right wing.
- Lower Long Cradle (7d weekly percentage):
  Longer duration (7 days) represented by a prominent long cradle wrapping around the bottom:
  - Spans from 195° (9:30 o'clock) down through 90° (6 o'clock) to 345° (2:30 o'clock), span = 210°.
  - Fills clockwise from left to right as 7d quota remains.
- Colors:
  - <= 20%: #ef4444 (Vibrant Red)
  - <= 50%: #f59e0b (Vibrant Amber/Yellow)
  - > 50%: #10b981 (Vibrant Emerald/Green)
"""
import sys
import os
import math
import subprocess
import glob
from concurrent.futures import ThreadPoolExecutor

CX = 60.0
CY = 60.0
R = 48.0
TO_RAD = math.pi / 180.0
TRACK_COLOR = "#3f3f46"

def pt(deg, r=R):
    rad = deg * TO_RAD
    return CX + r * math.cos(rad), CY + r * math.sin(rad)

def get_color(p):
    if p <= 20.0:
        return "#ef4444"
    elif p <= 50.0:
        return "#f59e0b"
    else:
        return "#10b981"

def generate_upper_svg(p_percent=50.0):
    p = max(0.0, min(100.0, float(p_percent)))
    color = get_color(p)

    paths = []
    # Left wing track: 215° to 245°
    lx1, ly1 = pt(215)
    lx2, ly2 = pt(245)
    paths.append(f'<path d="M {lx1:.2f} {ly1:.2f} A {R} {R} 0 0 1 {lx2:.2f} {ly2:.2f}" fill="none" stroke="{TRACK_COLOR}" stroke-width="7.5" stroke-linecap="round" />')

    # Right wing track: 295° to 325°
    rx1, ry1 = pt(295)
    rx2, ry2 = pt(325)
    paths.append(f'<path d="M {rx1:.2f} {ry1:.2f} A {R} {R} 0 0 1 {rx2:.2f} {ry2:.2f}" fill="none" stroke="{TRACK_COLOR}" stroke-width="7.5" stroke-linecap="round" />')

    # Progress fill (0~50% on left wing, 50~100% on right wing)
    if p > 0.5:
        if p <= 50.0:
            sw = (p / 50.0) * 30.0
            end_ang = 215.0 + sw
            ex, ey = pt(end_ang)
            paths.append(f'<path d="M {lx1:.2f} {ly1:.2f} A {R} {R} 0 0 1 {ex:.2f} {ey:.2f}" fill="none" stroke="{color}" stroke-width="7.5" stroke-linecap="round" />')
        else:
            paths.append(f'<path d="M {lx1:.2f} {ly1:.2f} A {R} {R} 0 0 1 {lx2:.2f} {ly2:.2f}" fill="none" stroke="{color}" stroke-width="7.5" stroke-linecap="round" />')
            sw = ((p - 50.0) / 50.0) * 30.0
            end_ang = 295.0 + sw
            ex, ey = pt(end_ang)
            paths.append(f'<path d="M {rx1:.2f} {ry1:.2f} A {R} {R} 0 0 1 {ex:.2f} {ey:.2f}" fill="none" stroke="{color}" stroke-width="7.5" stroke-linecap="round" />')

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
{chr(10).join(paths)}
</svg>'''

def generate_lower_svg(p_percent=50.0):
    p = max(0.0, min(100.0, float(p_percent)))
    color = get_color(p)

    paths = []
    # Long cradle track: from 195° down through 90° (6 o'clock) to 345° (span 210°)
    bx1, by1 = pt(195)
    bx2, by2 = pt(345)
    paths.append(f'<path d="M {bx1:.2f} {by1:.2f} A {R} {R} 0 1 0 {bx2:.2f} {by2:.2f}" fill="none" stroke="{TRACK_COLOR}" stroke-width="7.5" stroke-linecap="round" />')

    # Progress fill (0~100% of 210° clockwise)
    if p > 0.5:
        sw = (p / 100.0) * 210.0
        end_ang = (195.0 - sw) % 360.0
        ex, ey = pt(end_ang)
        large_arc = 1 if sw > 180.0 else 0
        paths.append(f'<path d="M {bx1:.2f} {by1:.2f} A {R} {R} 0 {large_arc} 0 {ex:.2f} {ey:.2f}" fill="none" stroke="{color}" stroke-width="7.5" stroke-linecap="round" />')

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
{chr(10).join(paths)}
</svg>'''

def generate_combined_duo_svg(p_top=50.0, p_bottom=50.0):
    upper = generate_upper_svg(p_top)
    lower = generate_lower_svg(p_bottom)
    # Extract path tags
    u_paths = [line for line in upper.splitlines() if line.strip().startswith("<path")]
    l_paths = [line for line in lower.splitlines() if line.strip().startswith("<path")]
    all_paths = u_paths + l_paths

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
{chr(10).join(all_paths)}
</svg>'''

def pregenerate_all():
    home = os.path.expanduser("~")
    dirs = [
        os.path.join(home, ".config/herdr-app/mods/openusage/cache"),
        os.path.join(home, "Project/herdr-mods/openusage/cache"),
    ]
    for d in dirs:
        os.makedirs(d, exist_ok=True)
        # Generate upper-0.svg to upper-100.svg
        # Generate lower-0.svg to lower-100.svg
        # Generate duo-0.svg to duo-100.svg (for backward compatibility)
        for p in range(101):
            upper_content = generate_upper_svg(p)
            with open(os.path.join(d, f"upper-{p}.svg"), "w", encoding="utf-8") as f:
                f.write(upper_content)

            lower_content = generate_lower_svg(p)
            with open(os.path.join(d, f"lower-{p}.svg"), "w", encoding="utf-8") as f:
                f.write(lower_content)

            combined_content = generate_combined_duo_svg(p, p)
            with open(os.path.join(d, f"duo-{p}.svg"), "w", encoding="utf-8") as f:
                f.write(combined_content)

        # Default fallbacks
        with open(os.path.join(d, "duo-default.svg"), "w", encoding="utf-8") as f:
            f.write(generate_combined_duo_svg(50, 50))
        with open(os.path.join(d, "upper-default.svg"), "w", encoding="utf-8") as f:
            f.write(generate_upper_svg(50))
        with open(os.path.join(d, "lower-default.svg"), "w", encoding="utf-8") as f:
            f.write(generate_lower_svg(50))

        # Convert all SVGs to PNGs using native macOS sips tool
        def to_png(f):
            subprocess.run(["sips", "-s", "format", "png", f, "--out", f[:-4] + ".png"], capture_output=True)
        svg_files = glob.glob(os.path.join(d, "*.svg"))
        with ThreadPoolExecutor(max_workers=8) as ex:
            list(ex.map(to_png, svg_files))

    print("Pre-generated inverted upper-0..100 (short), lower-0..100 (long) SVGs & PNGs successfully.")

if __name__ == "__main__":
    pregenerate_all()
