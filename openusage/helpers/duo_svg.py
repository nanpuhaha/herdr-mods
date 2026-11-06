#!/usr/bin/env python3
"""
Status-Trio Style Inverted Dual Arc Gauge Generator for OpenUsage.
Design Architecture:
- Upper Short Arch (5h / 24h percentage):
  Shorter duration (5 hours) represented by a sleek continuous arch spanning across the top:
  - Arch: 230° to 310° (span 80°, centered at 270° / 12 o'clock)
  - Fills clockwise from left to right (230° to 310°)
  - Top 5h/24h % text is positioned above this arch
- Lower Long Cradle (7d weekly percentage):
  Longer duration (7 days) represented by a prominent long cradle wrapping around the bottom:
  - Spans from 195° (9:30 o'clock) down through 90° (6 o'clock) to 345° (2:30 o'clock), span = 210°.
  - Fills from left to right across the bottom as 7d quota remains.
  - Symmetrical 35° gaps on both left (195°~230°) and right (310°~345°).
- Colors:
  - <= 20%: #ef4444 (Vibrant Red)
  - <= 50%: #f59e0b (Vibrant Amber/Yellow)
  - > 50%: #3b82f6 (Vibrant Blue, OpenUsage default)
- Pace Guidelines:
  - White tick marks crossing the arc track to indicate expected quota pacing.
"""
import sys
import os
import math
import subprocess
import glob
from concurrent.futures import ThreadPoolExecutor

CX = 60.0
CY = 60.0
R = 42.0
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
        return "#3b82f6"

def generate_upper_svg(p_percent=50.0):
    p = max(0.0, min(100.0, float(p_percent)))
    color = get_color(p)

    paths = []
    # Short continuous arch track: 230° to 310° (span 80°)
    tx1, ty1 = pt(230)
    tx2, ty2 = pt(310)
    paths.append(f'<path d="M {tx1:.2f} {ty1:.2f} A {R} {R} 0 0 1 {tx2:.2f} {ty2:.2f}" fill="none" stroke="{TRACK_COLOR}" stroke-width="7.5" stroke-linecap="round" />')

    # Progress fill: clockwise from 230°
    if p > 0.5:
        sw = (p / 100.0) * 80.0
        end_ang = 230.0 + sw
        ex, ey = pt(end_ang)
        paths.append(f'<path d="M {tx1:.2f} {ty1:.2f} A {R} {R} 0 0 1 {ex:.2f} {ey:.2f}" fill="none" stroke="{color}" stroke-width="7.5" stroke-linecap="round" />')

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
{chr(10).join(paths)}
</svg>'''

def generate_upper_tick_svg(p_percent=50.0):
    p = max(0.0, min(100.0, float(p_percent)))
    ang = 230.0 + (p / 100.0) * 80.0
    rad = ang * TO_RAD
    cosA, sinA = math.cos(rad), math.sin(rad)
    in_r = R - 4.5
    out_r = R + 4.5
    x1, y1 = CX + in_r * cosA, CY + in_r * sinA
    x2, y2 = CX + out_r * cosA, CY + out_r * sinA
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
  <line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" opacity="0.95" />
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

def generate_lower_tick_svg(p_percent=50.0):
    p = max(0.0, min(100.0, float(p_percent)))
    ang = (195.0 - (p / 100.0) * 210.0) % 360.0
    rad = ang * TO_RAD
    cosA, sinA = math.cos(rad), math.sin(rad)
    in_r = R - 4.5
    out_r = R + 4.5
    x1, y1 = CX + in_r * cosA, CY + in_r * sinA
    x2, y2 = CX + out_r * cosA, CY + out_r * sinA
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
  <line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" opacity="0.95" />
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
        # Generate upper-0..100, lower-0..100, duo-0..100
        # Generate upper-tick-0..100, lower-tick-0..100
        for p in range(101):
            with open(os.path.join(d, f"upper-{p}.svg"), "w", encoding="utf-8") as f:
                f.write(generate_upper_svg(p))

            with open(os.path.join(d, f"lower-{p}.svg"), "w", encoding="utf-8") as f:
                f.write(generate_lower_svg(p))

            with open(os.path.join(d, f"upper-tick-{p}.svg"), "w", encoding="utf-8") as f:
                f.write(generate_upper_tick_svg(p))

            with open(os.path.join(d, f"lower-tick-{p}.svg"), "w", encoding="utf-8") as f:
                f.write(generate_lower_tick_svg(p))

            with open(os.path.join(d, f"duo-{p}.svg"), "w", encoding="utf-8") as f:
                f.write(generate_combined_duo_svg(p, p))

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

    print("Pre-generated inverted upper, lower, and pace tick SVGs & PNGs successfully (with Blue #3b82f6).")

if __name__ == "__main__":
    pregenerate_all()
