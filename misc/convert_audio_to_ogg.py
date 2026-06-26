#!/usr/bin/env python3
"""
Converte os áudios do projeto para OGG Vorbis e atualiza/cria manifest.json das músicas.

Perfis:
- assets/sound ou assets/sounds: efeitos/ambiente -> mono, 22.05 kHz, qualidade 3
- music: músicas -> stereo, 44.1 kHz, qualidade 4

Uso:
  python3 convert_audio_to_ogg.py
  python3 convert_audio_to_ogg.py --root ./public/assets/sound
  python3 convert_audio_to_ogg.py --delete-originals

Requer ffmpeg instalado.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

INPUT_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".flac"}


@dataclass(frozen=True)
class Profile:
    name: str
    channels: int
    sample_rate: int
    vorbis_quality: int


SOUND_PROFILE = Profile("sounds", channels=1, sample_rate=22050, vorbis_quality=3)
MUSIC_PROFILE = Profile("music", channels=2, sample_rate=44100, vorbis_quality=4)


def find_default_root() -> Path:
    candidates = [
        Path("../public/assets/sound"),
        Path("../public/assets/sounds"),
        Path("../assets/sound"),
        Path("../assets/sounds"),
        Path("../sound"),
        Path("../sounds"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return Path("../public/assets/sound")


def is_music_file(path: Path) -> bool:
    return any(part.lower() == "music" for part in path.parts)


def profile_for(path: Path) -> Profile:
    return MUSIC_PROFILE if is_music_file(path) else SOUND_PROFILE


def run_ffmpeg(src: Path, dst: Path, profile: Profile) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_suffix(".tmp.ogg")

    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(src),
        "-vn",
        "-map_metadata",
        "-1",
        "-ac",
        str(profile.channels),
        "-ar",
        str(profile.sample_rate),
        "-c:a",
        "libvorbis",
        "-q:a",
        str(profile.vorbis_quality),
        str(tmp),
    ]

    subprocess.run(cmd, check=True)
    tmp.replace(dst)


def convert_file(src: Path, delete_originals: bool) -> tuple[Path, int, int, str]:
    profile = profile_for(src)
    dst = src.with_suffix(".ogg")
    before = src.stat().st_size

    if src.suffix.lower() == ".ogg":
        return src, before, before, "skip"

    run_ffmpeg(src, dst, profile)
    after = dst.stat().st_size

    if delete_originals:
        src.unlink()

    return src, before, after, profile.name


def collect_audio_files(root: Path) -> list[Path]:
    return sorted(
        path
        for path in root.rglob("*")
        if path.is_file()
        and path.suffix.lower() in INPUT_EXTENSIONS
        and not path.name.startswith("._")
    )


def write_music_manifest(root: Path) -> None:
    music_dirs = sorted({path.parent for path in root.rglob("*.ogg") if is_music_file(path)})

    for music_dir in music_dirs:
        files = sorted(path.name for path in music_dir.glob("*.ogg") if path.is_file())
        manifest = music_dir / "manifest.json"
        manifest.write_text(json.dumps(files, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"manifest atualizado: {manifest} ({len(files)} músicas)")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=find_default_root())
    parser.add_argument("--delete-originals", action="store_true", help="Remove .mp3/.wav depois de gerar .ogg")
    parser.add_argument("--workers", type=int, default=0, help="Paralelismo. 0 = automático")
    args = parser.parse_args()

    root = args.root
    if not root.exists():
        print(f"Pasta não encontrada: {root}")
        return 1

    if shutil.which("ffmpeg") is None:
        print("ffmpeg não encontrado. Instale com: sudo apt install ffmpeg")
        return 1

    files = collect_audio_files(root)
    if not files:
        print(f"Nenhum áudio encontrado em: {root}")
        return 0

    workers = args.workers or min(8, max(1, len(files)))
    total_before = 0
    total_after = 0
    converted = 0
    skipped = 0

    print(f"Pasta: {root}")
    print(f"Arquivos encontrados: {len(files)}")
    print(f"Workers: {workers}\n")

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(convert_file, file, args.delete_originals) for file in files]

        for future in as_completed(futures):
            try:
                src, before, after, profile_name = future.result()
            except subprocess.CalledProcessError as err:
                print(f"ERRO ffmpeg: {err}")
                continue
            except Exception as err:
                print(f"ERRO: {err}")
                continue

            total_before += before
            total_after += after

            if profile_name == "skip":
                skipped += 1
                print(f"skip: {src}")
            else:
                converted += 1
                saved = before - after
                pct = (saved / before * 100) if before else 0
                print(f"{profile_name}: {src.name} | {before/1024:.1f} KB -> {after/1024:.1f} KB ({pct:.1f}% menor)")

    write_music_manifest(root)

    saved = total_before - total_after
    pct = (saved / total_before * 100) if total_before else 0

    print("\n=========================================")
    print(f"Convertidos: {converted}")
    print(f"Ignorados .ogg: {skipped}")
    print(f"Espaço antes: {total_before/1024/1024:.2f} MB")
    print(f"Espaço depois: {total_after/1024/1024:.2f} MB")
    print(f"Economia: {saved/1024/1024:.2f} MB ({pct:.1f}%)")
    print("=========================================")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
