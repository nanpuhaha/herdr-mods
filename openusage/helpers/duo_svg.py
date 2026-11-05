#!/usr/bin/env python3
"""
Status-Trio Style Dual Arc Gauge Generator for OpenUsage.
Faithfully implements https://github.com/lingyired/status-trio geometry:
- Upper Wide Arc (batteryArc): Horseshoe arc with top gap for 5h (or 24h) percentage.
  Left arm (148.69° -> 234.40°), Right arm (305.60° -> 391.31°).
  Fills evenly along the visible arc (0~50% on left, 50~100% on right).
- Lower Smile Arc (volumeArc): Bottom smile arc for 7d weekly percentage.
  Spans from 121.82° across 6 o'clock (90°) to 59.12°.
  Fills from left to right as 7d quota remains.
- Colors:
  - <= 20%: #ef4444 (Vibrant Red)
  - <= 50%: #f59e0b (Vibrant Amber/Yellow)
  - > 50%: #10b981 (Vibrant Emerald/Green)
"""
import sys
import os
import math

# StatusIconGeometry constants
CX = 59.5
CY = 61.487
R = 51.5
TO_RAD = math.pi / 180.0
TRACK_COLOR = "#3f3f46"

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
    # Left and Right tracks with top gap
    # Left: 148.69° to 234.40° (start: 15.50, 88.25 -> end: 29.52, 19.61)
    paths.append(f'<path d="M 15.50 88.25 A 51.5 51.5 0 0 1 29.52 19.61" fill="none" stroke="{TRACK_COLOR}" stroke-width="8" stroke-linecap="round" />')
    # Right: 305.60° to 391.31° (start: 89.48, 19.61 -> end: 103.50, 88.25)
    paths.append(f'<path d="M 89.48 19.61 A 51.5 51.5 0 0 1 103.50 88.25" fill="none" stroke="{TRACK_COLOR}" stroke-width="8" stroke-linecap="round" />')

    # Progress Fill in split mode (0-50% left arm, 50-100% right arm)
    if p > 0.5:
        if p <= 50.0:
            sw = (p / 50.0) * 85.71
            end_ang = 148.69 + sw
            ex = CX + R * math.cos(end_ang * TO_RAD)
            ey = CY + R * math.sin(end_ang * TO_RAD)
            paths.append(f'<path d="M 15.50 88.25 A 51.5 51.5 0 0 1 {ex:.2f} {ey:.2f}" fill="none" stroke="{color}" stroke-width="8" stroke-linecap="round" />')
        else:
            paths.append(f'<path d="M 15.50 88.25 A 51.5 51.5 0 0 1 29.52 19.61" fill="none" stroke="{color}" stroke-width="8" stroke-linecap="round" />')
            sw = ((p - 50.0) / 50.0) * 85.71
            end_ang = 305.60 + sw
            ex = CX + R * math.cos(end_ang * TO_RAD)
            ey = CY + R * math.sin(end_ang * TO_RAD)
            paths.append(f'<path d="M 89.48 19.61 A 51.5 51.5 0 0 1 {ex:.2f} {ey:.2f}" fill="none" stroke="{color}" stroke-width="8" stroke-linecap="round" />')

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
{chr(10).join(paths)}
</svg>'''

def generate_lower_svg(p_percent=50.0):
    p = max(0.0, min(100.0, float(p_percent)))
    color = get_color(p)

    paths = []
    # Smile track: 121.82° to 59.12° (start: 32.35, 105.25 -> end: 85.93, 105.69)
    paths.append(f'<path d="M 32.35 105.25 A 51.5 51.5 0 0 0 85.93 105.69" fill="none" stroke="{TRACK_COLOR}" stroke-width="7.5" stroke-linecap="round" />')

    # Progress Fill along smile from left to right
    if p > 0.5:
        sw = (p / 100.0) * 62.70
        end_ang = 121.82 - sw
        ex = CX + R * math.cos(end_ang * TO_RAD)
        ey = CY + R * math.sin(end_ang * TO_RAD)
        paths.append(f'<path d="M 32.35 105.25 A 51.5 51.5 0 0 0 {ex:.2f} {ey:.2f}" fill="none" stroke="{color}" stroke-width="7.5" stroke-linecap="round" />')

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
{chr(10).join(paths)}
</svg>'''

def generate_combined_duo_svg(p_top=50.0, p_bottom=50.0):
    p_t = max(0.0, min(100.0, float(p_top)))
    p_b = max(0.0, min(100.0, float(p_bottom)))
    c_top = get_color(p_t)
    c_bot = get_color(p_b)

    paths = []
    # Upper tracks
    paths.append(f'<path d="M 15.50 88.25 A 51.5 51.5 0 0 1 29.52 19.61" fill="none" stroke="{TRACK_COLOR}" stroke-width="8" stroke-linecap="round" />')
    paths.append(f'<path d="M 89.48 19.61 A 51.5 51.5 0 0 1 103.50 88.25" fill="none" stroke="{TRACK_COLOR}" stroke-width="8" stroke-linecap="round" />')

    # Upper fill
    if p_t > 0.5:
        if p_t <= 50.0:
            sw = (p_t / 50.0) * 85.71
            end_ang = 148.69 + sw
            ex = CX + R * math.cos(end_ang * TO_RAD)
            ey = CY + R * math.sin(end_ang * TO_RAD)
            paths.append(f'<path d="M 15.50 88.25 A 51.5 51.5 0 0 1 {ex:.2f} {ey:.2f}" fill="none" stroke="{c_top}" stroke-width="8" stroke-linecap="round" />')
        else:
            paths.append(f'<path d="M 15.50 88.25 A 51.5 51.5 0 0 1 29.52 19.61" fill="none" stroke="{c_top}" stroke-width="8" stroke-linecap="round" />')
            sw = ((p_t - 50.0) / 50.0) * 85.71
            end_ang = 305.60 + sw
            ex = CX + R * math.cos(end_ang * TO_RAD)
            ey = CY + R * math.sin(end_ang * TO_RAD)
            paths.append(f'<path d="M 89.48 19.61 A 51.5 51.5 0 0 1 {ex:.2f} {ey:.2f}" fill="none" stroke="{c_top}" stroke-width="8" stroke-linecap="round" />')

    # Lower smile track
    paths.append(f'<path d="M 32.35 105.25 A 51.5 51.5 0 0 0 85.93 105.69" fill="none" stroke="{TRACK_COLOR}" stroke-width="7.5" stroke-linecap="round" />')

    # Lower smile fill
    if p_b > 0.5:
        sw = (p_b / 100.0) * 62.70
        end_ang = 121.82 - sw
        ex = CX + R * math.cos(end_ang * TO_RAD)
        ey = CY + R * math.sin(end_ang * TO_RAD)
        paths.append(f'<path d="M 32.35 105.25 A 51.5 51.5 0 0 0 {ex:.2f} {ey:.2f}" fill="none" stroke="{c_bot}" stroke-width="7.5" stroke-linecap="round" />')

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
{chr(10).join(paths)}
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

        # Default fallback
        with open(os.path.join(d, "duo-default.svg"), "w", encoding="utf-8") as f:
            f.write(generate_combined_duo_svg(50, 50))

        # Also generate PNGs using macOS native sips
        import subprocess, glob
        from concurrent.futures import ThreadPoolExecutor
        def to_png(f):
            subprocess.run(["sips", "-s", "format", "png", f, "--out", f[:-4] + ".png"], capture_output=True)
        svg_files = glob.glob(os.path.join(d, "*.svg"))
        with ThreadPoolExecutor(max_workers=8) as ex:
            list(ex.map(to_png, svg_files))

    print("Pre-generated upper-0..100, lower-0..100, duo-0..100 SVGs & PNGs successfully.")

if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--all":
        pregenerate_all()
    elif len(sys.argv) >= 3:
        p_top = float(sys.argv[1])
        p_bot = float(sys.argv[2])
        print(generate_combined_duo_svg(p_top, p_bot))
    elif len(sys.argv) >= 2:
        p = float(sys.argv[1])
        print(generate_combined_duo_svg(p, p))
    else:
        pregenerate_all()
