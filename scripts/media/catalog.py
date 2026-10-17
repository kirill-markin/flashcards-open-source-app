from pathlib import Path
from typing import TypedDict
import hashlib

REPOSITORY = "kirill-markin/flashcards-open-source-app"
ROOT = Path(__file__).resolve().parents[2]
BUNDLE_ROOTS = {
    "ios-native": "apps/ios/docs/media/app-store-screenshots",
    "ios-cards": "apps/ios/docs/media/app-store-cards",
    "ios-marketing": "apps/ios/docs/media/marketing-materials",
    "ios-app-icon": "apps/ios/docs/media/app-icon",
    "android-native": "apps/android/docs/media/play-store-screenshots",
    "android-cards": "apps/android/docs/media/play-store-cards",
    "android-feature-graphics": "apps/android/docs/media/play-store-feature-graphic",
}
MEDIA_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif", ".heic", ".pdf", ".mov", ".mp4", ".ico", ".icns", ".psd", ".sketch"}


class FileRecord(TypedDict):
    path: str
    sha256: str
    size: int


class BundleRecord(TypedDict):
    root: str
    asset: str
    sha256: str
    size: int
    files: list[FileRecord]


class Manifest(TypedDict):
    schemaVersion: int
    repository: str
    releaseTag: str
    bundles: dict[str, BundleRecord]


def sha256_file(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def is_media(path: Path) -> bool:
    if path.suffix.lower() in MEDIA_SUFFIXES:
        return True
    contents = path.read_bytes()
    if b"\0" in contents:
        return True
    try:
        contents.decode("utf-8")
        return False
    except UnicodeDecodeError:
        return True
