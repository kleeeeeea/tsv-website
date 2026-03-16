from __future__ import annotations

import re
import subprocess
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
SOURCE_FILE = ROOT_DIR / "team-data.js"
DOWNLOAD_DIR = ROOT_DIR / ".tmp" / "player-cutouts" / "downloads"
OUTPUT_DIR = ROOT_DIR / "images" / "kader" / "cutouts"
REMBG_BIN = Path("/Users/leakleemann/Library/Python/3.13/bin/rembg")
REMBG_MODEL = "u2net_human_seg"


def normalize_image_url(value: str) -> str:
    if re.search(r"\.(?:avif|webp|png|jpe?g|svg)$", value, re.IGNORECASE):
        return value

    return f"{value.rstrip('/')}/480x600.webp"


def main() -> None:
    source = SOURCE_FILE.read_text(encoding="utf-8")
    image_urls = re.findall(r'imageUrl:\s*"([^"]+)"', source)
    unique_images: dict[str, str] = {}

    for image_url in image_urls:
        match = re.search(r"/player/([^/]+)", image_url, re.IGNORECASE)
        if not match:
            continue

        token = match.group(1)
        unique_images.setdefault(token, normalize_image_url(image_url))

    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    created = 0
    skipped = 0

    for token, remote_url in unique_images.items():
        download_file = DOWNLOAD_DIR / f"{token}.webp"
        output_file = OUTPUT_DIR / f"{token}.png"

        if output_file.exists() and output_file.stat().st_size > 1024:
            skipped += 1
            continue

        subprocess.run(["curl", "-L", remote_url, "-o", str(download_file)], cwd=ROOT_DIR, check=True)
        subprocess.run(
            [str(REMBG_BIN), "i", "-m", REMBG_MODEL, str(download_file), str(output_file)],
            cwd=ROOT_DIR,
            check=True,
        )
        created += 1

    print(
        f"Cutouts fertig. Neu erstellt: {created}, uebersprungen: {skipped}, gesamt: {len(unique_images)}"
    )


if __name__ == "__main__":
    main()
