import struct
import sys


def parse_aco(filepath):
    colors = []
    with open(filepath, 'rb') as f:
        # Read Version 1 header
        v1_data = f.read(4)
        if len(v1_data) < 4:
            print("File is too short or empty.")
            return

        v1, count1 = struct.unpack('>HH', v1_data)
        if v1 != 1:
            print(f"Unknown format or not an .aco file (Expected V1 header, got {v1}).")
            return
        
        # Skip V1 palettes (each V1 color record is 10 bytes: space(2) + 4 components(8))
        f.seek(count1 * 10, 1) 

        # Now check if Version 2 exists (version 2 typically follows version 1 and contains color names)
        v2_data = f.read(4)
        has_v2 = False
        count = count1
        
        if len(v2_data) == 4:
            v2, count2 = struct.unpack('>HH', v2_data)
            if v2 == 2:
                has_v2 = True
                count = count2
        
        if not has_v2:
            print("No Version 2 data found, falling back to Version 1.")
            # Go back to start of V1 palette if V2 doesn't exist
            f.seek(4)

        for i in range(count):
            # Read color components
            data = f.read(10)
            if len(data) < 10:
                break
            
            color_space, w, x, y, z = struct.unpack('>HHHHH', data)
            
            name = f"Color {i+1}"
            if has_v2:
                # In V2, each color is followed by length and string
                len_data = f.read(4) 
                if len(len_data) == 4:
                    # Actually, some tools found a zero word before the length, but spec says:
                    # 2 bytes color space, 8 bytes components, 2 bytes length, then string...
                    # Wait, let's look at the first 2 bytes vs next 2 bytes.
                    val1, val2 = struct.unpack('>HH', len_data)
                    # If val1 is 0, it might be padding, and val2 is the length.
                    if val1 == 0:
                        name_len = val2
                    else:
                        name_len = val1
                        # We read 2 extra bytes, so let's backtrack by 2
                        f.seek(-2, 1)
                    
                    name_bytes = f.read(name_len * 2)
                    try:
                        name = name_bytes[:-2].decode('utf-16-be') # strip null terminator
                    except UnicodeDecodeError:
                        name = "Unknown"

            # Color spaces mapping:
            # 0: RGB (scale by 65535/256 to get 0-255 roughly)
            # 1: HSB
            # 2: CMYK
            # 7: Lab
            # 8: Grayscale
            
            if color_space == 0:
                hex_color = "#{:02x}{:02x}{:02x}".format(w // 256, x // 256, y // 256)
                space_str = f"RGB({w // 256}, {x // 256}, {y // 256})"
            elif color_space == 2:
                space_str = f"CMYK({100 - w//655}, {100 - x//655}, {100 - y//655}, {100 - z//655})"
                hex_color = "N/A"
            elif color_space == 7:
                space_str = f"Lab({w/100:.2f}, {x/100:.2f}, {y/100:.2f})"
                hex_color = "N/A"
            else:
                space_str = f"Space[{color_space}] w={w} x={x} y={y} z={z}"
                hex_color = "N/A"

            colors.append({
                'name': name,
                'info': space_str,
                'hex': hex_color
            })

    return colors

if __name__ == "__main__":
    filepath = sys.argv[1] if len(sys.argv) > 1 else 'NUANCIER-CHROMATIC-DORVAL.aco'
    print(f"Reading colors from {filepath}...\n")
    colors = parse_aco(filepath)
    if colors:
        for idx, c in enumerate(colors):
            print(f"[{idx+1:03d}] {c['name']:<30} | {c['info']:<20} | Hex: {c['hex']}")
        print(f"\nTotal colors found: {len(colors)}")
