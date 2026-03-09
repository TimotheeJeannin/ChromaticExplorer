#!/usr/bin/env python3
"""Parse Adobe Color Swatch (.aco) files and extract color data."""

import csv
import struct
import sys
from pathlib import Path

# Color space names per Adobe .aco spec
COLOR_SPACES = {
    0: "RGB",
    1: "HSB",
    2: "CMYK",
    7: "Lab",
    8: "Grayscale",
}


def read_aco(filepath):
    """Read an .aco file and return a list of color dicts.

    Parses version 2 if present (includes color names), otherwise version 1.
    """
    data = Path(filepath).read_bytes()
    offset = 0

    # --- Version 1 block ---
    version, count = struct.unpack_from(">HH", data, offset)
    offset += 4
    if version != 1:
        raise ValueError(f"Expected version 1 header, got {version}")

    v1_colors = []
    for _ in range(count):
        space, c1, c2, c3, c4 = struct.unpack_from(">HHHHH", data, offset)
        offset += 10
        v1_colors.append((space, c1, c2, c3, c4))

    # --- Version 2 block (with names) ---
    if offset < len(data):
        version2, count2 = struct.unpack_from(">HH", data, offset)
        offset += 4
        if version2 == 2:
            colors = []
            for _ in range(count2):
                space, c1, c2, c3, c4 = struct.unpack_from(">HHHHH", data, offset)
                offset += 10
                # 4 bytes name length (uint32, including null terminator)
                name_len = struct.unpack_from(">I", data, offset)[0]
                offset += 4
                # name_len includes null terminator; each char is 2 bytes (UTF-16BE)
                name_bytes = data[offset : offset + name_len * 2]
                offset += name_len * 2
                name = name_bytes.decode("utf-16-be").rstrip("\x00")
                colors.append(_make_color(space, c1, c2, c3, c4, name))
            return colors

    # Fall back to version 1 (no names)
    return [_make_color(s, c1, c2, c3, c4) for s, c1, c2, c3, c4 in v1_colors]


def _make_color(space, c1, c2, c3, c4, name=""):
    """Convert raw .aco components to a readable color dict."""
    space_name = COLOR_SPACES.get(space, f"Unknown({space})")
    color = {"name": name, "space": space_name}

    if space == 0:  # RGB (16-bit values, divide by 257 for 8-bit)
        r, g, b = c1 // 257, c2 // 257, c3 // 257
        color.update(r=r, g=g, b=b, hex=f"#{r:02X}{g:02X}{b:02X}")
    elif space == 1:  # HSB
        h = round(c1 / 65535 * 360)
        s = round(c2 / 65535 * 100)
        br = round(c3 / 65535 * 100)
        color.update(h=h, s=s, b=br)
    elif space == 2:  # CMYK (values are 0-65535, 0=100%, 65535=0%)
        c_ = round((65535 - c1) / 65535 * 100)
        m = round((65535 - c2) / 65535 * 100)
        y = round((65535 - c3) / 65535 * 100)
        k = round((65535 - c4) / 65535 * 100)
        color.update(c=c_, m=m, y=y, k=k)
    elif space == 7:  # Lab
        l = c1 / 100
        a = (c2 - 12800) / 100
        b_val = (c3 - 12800) / 100
        color.update(l=round(l, 2), a=round(a, 2), b=round(b_val, 2))
    elif space == 8:  # Grayscale
        gray = round(c1 / 100, 2)
        color.update(gray=gray)
    else:
        color.update(c1=c1, c2=c2, c3=c3, c4=c4)

    return color


def export_csv(colors, output_path):
    """Export the color list to a CSV file."""
    if not colors:
        return
    fieldnames = list(colors[0].keys())
    # Gather all possible keys across all entries
    all_keys = set()
    for c in colors:
        all_keys.update(c.keys())
    fieldnames = [k for k in fieldnames if k in all_keys]
    for k in sorted(all_keys - set(fieldnames)):
        fieldnames.append(k)

    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(colors)
    print(f"Exported {len(colors)} colors to {output_path}")


def main():
    aco_file = sys.argv[1] if len(sys.argv) > 1 else "NUANCIER-CHROMATIC-DORVAL.aco"
    colors = read_aco(aco_file)

    print(f"File: {aco_file}")
    print(f"Total colors: {len(colors)}\n")

    # Show first 20 colors as a preview
    preview = colors[:20]
    for i, c in enumerate(preview, 1):
        if c["space"] == "RGB":
            print(f"  {i:4d}. {c.get('hex', '')}  R={c['r']:3d} G={c['g']:3d} B={c['b']:3d}  {c['name']}")
        else:
            print(f"  {i:4d}. [{c['space']}] {c['name']}")

    if len(colors) > 20:
        print(f"  ... and {len(colors) - 20} more colors")

    # Export to CSV
    csv_path = Path(aco_file).with_suffix(".csv")
    export_csv(colors, csv_path)


if __name__ == "__main__":
    main()
