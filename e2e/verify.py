"""Independent verification of a downloaded packet: reads each file with PIL / raw PDF parsing."""
import io
import re
import sys
import zipfile

from PIL import Image

path = sys.argv[1]
z = zipfile.ZipFile(path)
total = 0
for info in z.infolist():
    data = z.read(info)
    total += len(data)
    head = data[:8]
    line = f"{info.filename:55s} {len(data):>9,d} B"
    if head.startswith(b"\xff\xd8"):
        im = Image.open(io.BytesIO(data))
        dpi = im.info.get("dpi")
        exif = im.getexif()
        line += f"  JPEG {im.size[0]}x{im.size[1]} mode={im.mode} dpi={dpi} exif_tags={len(exif)}"
    elif head.startswith(b"\x89PNG"):
        im = Image.open(io.BytesIO(data))
        line += f"  PNG {im.size[0]}x{im.size[1]} mode={im.mode} dpi={im.info.get('dpi')}"
    elif data[:5] == b"%PDF-":
        # Count page objects (works for object-stream PDFs via /Count in the page tree root).
        counts = [int(m) for m in re.findall(rb"/Type\s*/Pages[^>]*?/Count\s+(\d+)", data)]
        counts += [int(m) for m in re.findall(rb"/Count\s+(\d+)[^>]*?/Type\s*/Pages", data)]
        line += f"  PDF pages~{max(counts) if counts else '?'} (object streams compress the tree)"
    else:
        line += f"  ?? {head!r}"
    print(line)
print(f"TOTAL {total:,d} bytes in {len(z.infolist())} files")
