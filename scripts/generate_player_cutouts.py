from __future__ import annotations

import hashlib
import json
import re
import subprocess
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
SOURCE_FILE = ROOT_DIR / "team-data.js"
DOWNLOAD_DIR = ROOT_DIR / ".tmp" / "player-cutouts" / "downloads"
OUTPUT_DIR = ROOT_DIR / "images" / "kader" / "cutouts"
MANIFEST_FILE = OUTPUT_DIR / "manifest.js"
STATE_FILE = ROOT_DIR / ".tmp" / "player-cutouts" / "cutout-state.json"
REMBG_BIN = Path("/Users/leakleemann/Library/Python/3.13/bin/rembg")
REMBG_MODEL = "u2net_human_seg"


def normalize_image_url(value: str) -> str:
    if re.search(r"\.(?:avif|webp|png|jpe?g|svg)$", value, re.IGNORECASE):
        return value

    return f"{value.rstrip('/')}/480x600.webp"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_state() -> dict[str, dict[str, str]]:
    if not STATE_FILE.exists():
        return {}

    return json.loads(STATE_FILE.read_text(encoding="utf-8"))


def save_state(state: dict[str, dict[str, str]]) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")


def write_manifest(state: dict[str, dict[str, str]]) -> None:
    manifest = {
        token: f"images/kader/cutouts/{token}.png?v={meta['cutout_version']}"
        for token, meta in sorted(state.items())
        if (OUTPUT_DIR / f"{token}.png").exists() and meta.get("cutout_version")
    }
    manifest_js = (
        "window.tsvCutoutManifest = "
        + json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=True)
        + ";\n"
    )
    MANIFEST_FILE.write_text(manifest_js, encoding="utf-8")


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
    state = load_state()

    created = 0
    refreshed = 0
    skipped = 0

    for token, remote_url in unique_images.items():
        download_file = DOWNLOAD_DIR / f"{token}.webp"
        output_file = OUTPUT_DIR / f"{token}.png"
        token_state = state.get(token, {})

        subprocess.run(["curl", "-L", remote_url, "-o", str(download_file)], cwd=ROOT_DIR, check=True)
        source_hash = sha256_file(download_file)

        if (
            output_file.exists()
            and output_file.stat().st_size > 1024
            and token_state.get("source_hash") == source_hash
        ):
            skipped += 1
            continue

        subprocess.run(
            [str(REMBG_BIN), "i", "-m", REMBG_MODEL, str(download_file), str(output_file)],
            cwd=ROOT_DIR,
            check=True,
        )
        cutout_hash = sha256_file(output_file)
        state[token] = {
            "remote_url": remote_url,
            "source_hash": source_hash,
            "cutout_version": cutout_hash[:12],
        }
        if token_state:
            refreshed += 1
        else:
            created += 1

    stale_tokens = [token for token in state if token not in unique_images]
    for token in stale_tokens:
        state.pop(token, None)

    save_state(state)
    write_manifest(state)
    print(
        "Cutouts fertig. "
        f"Neu erstellt: {created}, aktualisiert: {refreshed}, "
        f"uebersprungen: {skipped}, gesamt: {len(unique_images)}"
    )


if __name__ == "__main__":
    main()
