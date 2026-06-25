#!/usr/bin/env python3

from pathlib import Path
import json
import re
import unicodedata

MUSIC_DIR = Path("../assets/audio/music")

EXTENSIONS = {
    ".mp3",
    ".wav",
    ".ogg",
    ".m4a",
    ".flac",
    ".aac",
}


def normalize_filename(name: str) -> str:
    stem = Path(name).stem
    ext = Path(name).suffix.lower()

    # Remove acentos
    stem = unicodedata.normalize("NFKD", stem)
    stem = stem.encode("ascii", "ignore").decode()

    # Remove caracteres inválidos
    stem = re.sub(r"[^\w\s-]", "", stem)

    # Espaços e hífens viram "_"
    stem = re.sub(r"[\s-]+", "_", stem)

    # Remove múltiplos "_"
    stem = re.sub(r"_+", "_", stem)

    stem = stem.strip("_")

    return stem + ext


def main():
    if not MUSIC_DIR.exists():
        print(f"Pasta não encontrada: {MUSIC_DIR}")
        return

    manifest = []
    used = set()

    files = sorted(
        p for p in MUSIC_DIR.iterdir()
        if p.is_file() and p.suffix.lower() in EXTENSIONS
    )

    for file in files:
        new_name = normalize_filename(file.name)

        # evita nomes repetidos
        base = Path(new_name).stem
        ext = Path(new_name).suffix

        i = 2
        while new_name.lower() in used or (MUSIC_DIR / new_name).exists() and new_name != file.name:
            new_name = f"{base}_{i}{ext}"
            i += 1

        used.add(new_name.lower())

        new_path = MUSIC_DIR / new_name

        if file.name != new_name:
            print(f"{file.name} -> {new_name}")
            file.rename(new_path)

        manifest.append(new_name)

    manifest.sort()

    manifest_path = MUSIC_DIR / "manifest.json"

    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    print()
    print(f"✓ {len(manifest)} músicas encontradas.")
    print(f"✓ Manifest salvo em {manifest_path}")


if __name__ == "__main__":
    main()
