#!/usr/bin/env python3
"""
iPhone Duo Style Continuous Arch Gauge Generator for OpenUsage.
Generates 0% ~ 100% cached SVG widgets for sidebar rail view (< 140px).

Visual Design:
- Single continuous horseshoe/arch from 7 o'clock (125°) to 5 o'clock (415° / 55°)
- 0%: Empty track
- 16%: Fills from 7 o'clock to ~8:30 (Red)
- 50%: Fills from 7 o'clock to 12 o'clock top (Amber)
- 100%: Fills entire arch to 5 o'clock (Emerald)
- Colors:
  - <= 20%: #ef4444 (Vibrant Red)
  - <= 50%: #f59e0b (Vibrant Amber/Yellow)
  - > 50%: #10b981 (Vibrant Emerald/Green)
- 4 Bottom Pace Dots along the bottom 70° opening
"""
import sys
import os
import math

def generate_arc_svg_content(p_percent=50.0):
    cx, cy, r = 24, 24, 17
    to_rad = math.pi / 180.0
    p = max(0.0, min(100.0, float(p_percent)))

    # Color calculation matching gauge & text
    if p <= 20.0:
        color = "#ef4444"
    elif p <= 50.0:
        color = "#f59e0b"
    else:
        color = "#10b981"

    track_color = "#3f3f46"

    # Arch from 125° to 415° (span 290°)
    x_start = cx + r * math.cos(125 * to_rad)
    y_start = cy + r * math.sin(125 * to_rad)
    x_end = cx + r * math.cos(415 * to_rad)
    y_end = cy + r * math.sin(415 * to_rad)

    track_path = f'<path d="M {x_start:.2f} {y_start:.2f} A 17 17 0 1 1 {x_end:.2f} {y_end:.2f}" fill="none" stroke="{track_color}" stroke-width="2.6" stroke-linecap="round" />'

    prog_path = ""
    if p > 0.5:
        span = 290.0 * (p / 100.0)
        ang = 125.0 + span
        x_prog = cx + r * math.cos(ang * to_rad)
        y_prog = cy + r * math.sin(ang * to_rad)
        large_arc = 1 if span > 180.0 else 0
        prog_path = f'<path d="M {x_start:.2f} {y_start:.2f} A 17 17 0 {large_arc} 1 {x_prog:.2f} {y_prog:.2f}" fill="none" stroke="{color}" stroke-width="2.6" stroke-linecap="round" />'

    # 4 Bottom Pace Dots: angles 107°, 96°, 84°, 73°
    dot_angles = [107, 96, 84, 73]
    lit_count = 4 if p >= 75 else (3 if p >= 50 else (2 if p >= 25 else (1 if p > 0 else 0)))
    dots = []
    for i, ang in enumerate(dot_angles):
        dx = cx + r * math.cos(ang * to_rad)
        dy = cy + r * math.sin(ang * to_rad)
        fill = color if i < lit_count else track_color
        dots.append(f'  <circle cx="{dx:.2f}" cy="{dy:.2f}" r="1.2" fill="{fill}" />')

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
  {track_path}
  {prog_path}
{chr(10).join(dots)}
</svg>'''

def pregenerate_all():
    home = os.path.expanduser("~")
    dirs = [
        os.path.join(home, ".config/herdr-app/mods/openusage/cache"),
        os.path.join(home, "Project/herdr-mods/openusage/cache"),
    ]
    for d in dirs:
        os.makedirs(d, exist_ok=True)
        # Generate duo-0.svg to duo-100.svg
        for p in range(101):
            svg_content = generate_arc_svg_content(p)
            path = os.path.join(d, f"duo-{p}.svg")
            with open(path, "w", encoding="utf-8") as f:
                f.write(svg_content)
        # Also default
        default_svg = generate_arc_svg_content(50)
        with open(os.path.join(d, "duo-default.svg"), "w", encoding="utf-8") as f:
            f.write(default_svg)
    print("Pre-generated duo-0.svg .. duo-100.svg (101 files) successfully.")

if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--all":
        pregenerate_all()
    elif len(sys.argv) >= 2:
        p = float(sys.argv[1])
        print(generate_arc_svg_content(p))
    else:
        pregenerate_all()
