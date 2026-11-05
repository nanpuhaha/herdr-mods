#!/usr/bin/env python3
"""
iPhone Duo Style Circular Gauge Generator for OpenUsage.
Generates cached SVG widgets for sidebar rail view (< 140px).

Visual Design:
- 0% ~ 50%: Fills Left Arc from bottom (115°) to top (245°)
- 50% ~ 100%: Fills Right Arc from top (295°) to bottom (425° / 65°)
- 100% -> 0%: Gradually decreases along the circular track like a real battery gauge!
- Colors:
  - <= 20% or spent: #ef4444 (Vibrant Red)
  - <= 50% or behind: #f59e0b (Vibrant Amber/Yellow)
  - > 50%: #10b981 (Vibrant Emerald/Green)
"""
import sys
import os
import math

def generate_duo_svg_content(p_percent=50.0, pace="ahead", track_color="#3f3f46"):
    cx, cy, r = 24, 25, 17
    to_rad = math.pi / 180.0

    p = max(0.0, min(100.0, float(p_percent)))

    # Color calculation matching gauge & text
    if p <= 20.0 or pace == "spent":
        color = "#ef4444"
    elif p <= 50.0 or pace == "behind":
        color = "#f59e0b"
    else:
        color = "#10b981"

    # Left Track & Progress: 115° to 245° (clockwise arc, span 130°)
    x1_start, y1_start = 16.82, 40.41
    x1_end_track, y1_end_track = 16.82, 9.59
    left_prog = ""

    if p > 0.5:
        ratio1 = min(1.0, p / 50.0)
        ang1 = 115.0 + 130.0 * ratio1
        rad1 = ang1 * to_rad
        x1 = cx + r * math.cos(rad1)
        y1 = cy + r * math.sin(rad1)
        left_prog = f'<path d="M {x1_start} {y1_start} A 17 17 0 0 1 {x1:.2f} {y1:.2f}" fill="none" stroke="{color}" stroke-width="2.6" stroke-linecap="round" />'

    # Right Track & Progress: 295° to 425° (clockwise arc, span 130°)
    x2_start, y2_start = 31.18, 9.59
    x2_end_track, y2_end_track = 31.18, 40.41
    right_prog = ""

    if p > 50.5:
        ratio2 = min(1.0, (p - 50.0) / 50.0)
        ang2 = 295.0 + 130.0 * ratio2
        rad2 = ang2 * to_rad
        x2 = cx + r * math.cos(rad2)
        y2 = cy + r * math.sin(rad2)
        right_prog = f'<path d="M {x2_start} {y2_start} A 17 17 0 0 1 {x2:.2f} {y2:.2f}" fill="none" stroke="{color}" stroke-width="2.6" stroke-linecap="round" />'

    # 4 Bottom Pace Dots: 106°, 95°, 85°, 74°
    dot_angles = [106, 95, 85, 74]
    if p >= 75:
        lit_count = 4
    elif p >= 50:
        lit_count = 3
    elif p >= 25:
        lit_count = 2
    elif p > 0:
        lit_count = 1
    else:
        lit_count = 0

    if pace == "behind":
        lit_count = min(lit_count, 2)
    elif pace == "spent":
        lit_count = min(lit_count, 1)

    dots = []
    for i, ang in enumerate(dot_angles):
        rad = ang * to_rad
        dx = cx + r * math.cos(rad)
        dy = cy + r * math.sin(rad)
        fill = color if i < lit_count else track_color
        dots.append(f'  <circle cx="{dx:.2f}" cy="{dy:.2f}" r="1.35" fill="{fill}" />')

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
  <!-- Left Track -->
  <path d="M {x1_start} {y1_start} A 17 17 0 0 1 {x1_end_track} {y1_end_track}" fill="none" stroke="{track_color}" stroke-width="2.6" stroke-linecap="round" />
  {left_prog}
  <!-- Right Track -->
  <path d="M {x2_start} {y2_start} A 17 17 0 0 1 {x2_end_track} {y2_end_track}" fill="none" stroke="{track_color}" stroke-width="2.6" stroke-linecap="round" />
  {right_prog}
  <!-- Pace Dots -->
{chr(10).join(dots)}
</svg>'''

def save_gauge_svg(acc_id, p_percent=50.0, pace="ahead"):
    svg_content = generate_duo_svg_content(p_percent, pace)
    home = os.path.expanduser("~")
    dirs = [
        os.path.join(home, ".config/herdr-app/mods/openusage/cache"),
        os.path.join(home, "Project/herdr-mods/openusage/cache"),
    ]
    for d in dirs:
        try:
            os.makedirs(d, exist_ok=True)
            path = os.path.join(d, f"duo-{acc_id}.svg")
            with open(path, "w", encoding="utf-8") as f:
                f.write(svg_content)
        except Exception:
            pass

if __name__ == "__main__":
    if len(sys.argv) >= 3:
        acc_id = sys.argv[1]
        p_percent = float(sys.argv[2])
        pace = sys.argv[3] if len(sys.argv) >= 4 else "ahead"
        save_gauge_svg(acc_id, p_percent, pace)
        print(f"Generated duo-{acc_id}.svg (p={p_percent}%, pace={pace})")
    elif len(sys.argv) >= 2 and sys.argv[1] == "--init-all":
        presets = [
            ("claude-default", 72.0, "onTrack"),
            ("codex-default", 50.0, "ahead"),
            ("antigravity-default", 90.0, "ahead"),
            ("opencode-default", 16.0, "spent"),
            ("default", 50.0, "onTrack"),
        ]
        for acc_id, p, pace in presets:
            save_gauge_svg(acc_id, p, pace)
        print("Pre-generated default Duo SVGs.")
    else:
        print("Usage: duo_svg.py <acc_id> <p_percent> [pace] OR duo_svg.py --init-all")
