#!/usr/bin/env python3

"""
download_music.py

Baixa e converte áudio para MP3 320 kbps usando yt-dlp + ffmpeg.

Uso permitido: utilize apenas com conteúdos que você possui, que são livres,
Creative Commons, domínio público, ou para os quais você tem permissão explícita.

Requisitos externos:
  - Python 3.9+
  - ffmpeg instalado no PATH
  - yt-dlp e tqdm instalados via requirements.txt

Exemplos:
    python download_music.py --input meus_links.txt
"""

from __future__ import annotations

import argparse
import concurrent.futures as futures
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from tqdm import tqdm
from yt_dlp import YoutubeDL

OUTPUT_DIR = Path("../assets/audio/music")
DEFAULT_INPUT = Path("music.txt")
THREADS = 4
MP3_BITRATE = "320k"

INVALID_FILENAME_CHARS = r'<>:"/\\|?*\0'


def sanitize_filename(name: str, max_len: int = 180) -> str:
    table = str.maketrans({c: "_" for c in INVALID_FILENAME_CHARS})
    clean = name.translate(table)
    clean = re.sub(r"\s+", " ", clean).strip()
    clean = clean.rstrip(". ")
    return clean[:max_len] or "audio"


def ensure_tools() -> None:
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg não encontrado no PATH.")


def load_urls(path: Path) -> list[str]:
    if not path.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {path}")

    return [
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]


def ffmpeg_to_mp3(input_file: Path, output_file: Path) -> None:
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(input_file),
        "-vn",
        "-af",
        "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        MP3_BITRATE,
        str(output_file),
    ]

    subprocess.run(cmd, check=True)


def download_audio(url: str, output_dir: Path) -> tuple[str, str, str]:
    """
    Retorna:
      (status, title, message)

    status:
      downloaded | skipped | error
    """
    try:
        with tempfile.TemporaryDirectory(prefix="music_dl_") as tmp:
            temp_dir = Path(tmp)

            ydl_opts = {
                "format": "bestaudio/best",
                "outtmpl": str(temp_dir / "%(title)s.%(ext)s"),
                "quiet": True,
                "no_warnings": True,
                "noplaylist": True,
                "retries": 3,
                "fragment_retries": 3,
            }

            with YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)

                title = info.get("title") or info.get("id") or "audio"
                safe_title = sanitize_filename(title)
                output_file = output_dir / f"{safe_title}.mp3"

                if output_file.exists() and output_file.stat().st_size > 0:
                    return "skipped", title, "já existe"

                info = ydl.extract_info(url, download=True)
                downloaded_file = Path(ydl.prepare_filename(info))

            if not downloaded_file.exists():
                candidates = list(temp_dir.glob("*"))
                if not candidates:
                    return "error", url, "arquivo baixado não encontrado"
                downloaded_file = candidates[0]

            temp_mp3 = temp_dir / f"{safe_title}.mp3"
            ffmpeg_to_mp3(downloaded_file, temp_mp3)

            shutil.move(str(temp_mp3), str(output_file))

            return "downloaded", title, output_file.name

    except Exception as exc:
        return "error", url, str(exc)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Baixa áudios do YouTube por links em um .txt e converte para MP3 320 kbps."
    )

    parser.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_INPUT,
        help="Arquivo .txt com um link do YouTube por linha.",
    )

    parser.add_argument(
        "--output-dir",
        type=Path,
        default=OUTPUT_DIR,
        help="Pasta de saída dos MP3.",
    )

    parser.add_argument(
        "--threads",
        type=int,
        default=THREADS,
        help="Quantidade de downloads paralelos.",
    )

    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        ensure_tools()
        args.output_dir.mkdir(parents=True, exist_ok=True)
        urls = load_urls(args.input)
    except Exception as exc:
        print(f"Erro: {exc}", file=sys.stderr)
        return 1

    if not urls:
        print(f"Nenhum link encontrado em: {args.input}")
        return 1

    downloaded = 0
    skipped = 0
    errors = 0

    workers = max(1, min(args.threads, 16))

    with futures.ThreadPoolExecutor(max_workers=workers) as executor:
        tasks = [
            executor.submit(download_audio, url, args.output_dir)
            for url in urls
        ]

        for task in tqdm(
            futures.as_completed(tasks),
            total=len(tasks),
            desc="Baixando",
            unit="música",
        ):
            status, title, message = task.result()

            if status == "downloaded":
                downloaded += 1
                tqdm.write(f"✓ {title} -> {message}")
            elif status == "skipped":
                skipped += 1
                tqdm.write(f"- {title} ignorada ({message})")
            else:
                errors += 1
                tqdm.write(f"✗ {title}: {message}")

    print("\nResumo")
    print(f"✓ baixadas: {downloaded}")
    print(f"✓ ignoradas: {skipped}")
    print(f"✓ erros: {errors}")

    return 0 if errors == 0 else 3


if __name__ == "__main__":
    raise SystemExit(main())