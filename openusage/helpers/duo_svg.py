#!/usr/bin/env python3
"""
iPhone Duo Style Circular Gauge Generator for OpenUsage.
Generates cached SVG widgets for sidebar rail view (< 140px).
"""
import sys
import os
import math
import json

def generate_duo_svg_content(p1=1.0, p2=1.0, pace="ahead", track_color="#3f3f46"):
    cx, cy, r = 24, 25, 17
    to_rad = math.pi / 180.0

    # Colors
    c1 = "#ef4444" if (p1 < 0.2 or pace == "spent") else ("#f59e0b" if pace == "behind" else "#10b981")
    c2 = "#ef4444" if p2 < 0.2 else ("#f59e0b" if p2 < 0.5 else "#06b6d4")

    # Left Track & Progress (5h): 115° to 245° (span 130°, clockwise)
    x1_start, y1_start = 16.82, 40.41
    x1_end_track, y1_end_track = 16.82, 9.59
    left_prog_path = ""
    if p1 > 0.005:
        ang1 = 115 + 130 * min(1.0, max(0.01, p1))
        rad1 = ang1 * to_rad
        x1_prog = cx + r * math.cos(rad1)
        y1_prog = cy + r * math.sin(rad1)
        left_prog_path = f'<path d="M {x1_start} {y1_start} A 17 17 0 0 1 {x1_prog:.2f} {y1_prog:.2f}" fill="none" stroke="{c1}" stroke-width="2.6" stroke-linecap="round" />'

    # Right Track & Progress (Weekly): 65° to -65° (span 130°, counter-clockwise)
    x2_start, y2_start = 31.18, 40.41
    x2_end_track, y2_end_track = 31.18, 9.59
    right_prog_path = ""
    if p2 > 0.005:
        ang2 = 65 - 130 * min(1.0, max(0.01, p2))
        rad2 = ang2 * to_rad
        x2_prog = cx + r * math.cos(rad2)
        y2_prog = cy + r * math.sin(rad2)
        right_prog_path = f'<path d="M {x2_start} {y2_start} A 17 17 0 0 0 {x2_prog:.2f} {y2_prog:.2f}" fill="none" stroke="{c2}" stroke-width="2.6" stroke-linecap="round" />'

    # 4 Bottom Pace Dots: 106°, 95°, 85°, 74°
    dot_angles = [106, 95, 85, 74]
    lit_count = 4
    dot_color = "#10b981"
    if pace == "onTrack":
        lit_count = 3
        dot_color = "#10b981"
    elif pace == "behind":
        lit_count = 2
        dot_color = "#f59e0b"
    elif pace == "spent":
        lit_count = 1
        dot_color = "#ef4444"
    elif pace == "idle":
        lit_count = 0

    dots_svg = []
    for i, ang in enumerate(dot_angles):
        rad = ang * to_rad
        dx = cx + r * math.cos(rad)
        dy = cy + r * math.sin(rad)
        is_lit = i < lit_count
        fill = dot_color if is_lit else track_color
        dots_svg.append(f'  <circle cx="{dx:.2f}" cy="{dy:.2f}" r="1.35" fill="{fill}" />')

    dots_str = "\n".join(dots_svg)

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
  <!-- Left Track (5h) -->
  <path d="M {x1_start} {y1_start} A 17 17 0 0 1 {x1_end_track} {y1_end_track}" fill="none" stroke="{track_color}" stroke-width="2.6" stroke-linecap="round" />
  {left_prog_path}
  <!-- Right Track (Weekly) -->
  <path d="M {x2_start} {y2_start} A 17 17 0 0 0 {x2_end_track} {y2_end_track}" fill="none" stroke="{track_color}" stroke-width="2.6" stroke-linecap="round" />
  {right_prog_path}
  <!-- Pace Dots -->
{dots_str}
</svg>'''

def save_gauge_svg(acc_id, p1=1.0, p2=1.0, pace="ahead"):
    svg_content = generate_duo_svg_content(p1, p2, pace)
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
    # If args given: python3 duo_svg.py <acc_id> <p1> <p2> <pace>
    if len(sys.argv) >= 5:
        acc_id = sys.argv[1]
        p1 = float(sys.argv[2])
        p2 = float(sys.argv[3])
        pace = sys.argv[4]
        save_gauge_svg(acc_id, p1, p2, pace)
        print(f"Generated duo-{acc_id}.svg (p1={p1}, p2={p2}, pace={pace})")
    elif len(sys.argv) >= 2 and sys.argv[1] == "--init-all":
        # Pre-generate default preset SVGs
        presets = [
            ("claude-default", 0.72, 0.85, "onTrack"),
            ("codex-default", 0.50, 0.65, "ahead"),
            ("antigravity-default", 0.90, 0.95, "ahead"),
            ("opencode-default", 0.40, 0.55, "behind"),
        ]
        for acc_id, p1, p2, pace in presets:
            save_gauge_svg(acc_id, p1, p2, pace)
        print("Pre-generated default Duo SVGs.")
    else:
        print("Usage: duo_svg.py <acc_id> <p1> <p2> <pace> OR duo_svg.py --init-all")
