import argparse
import asyncio
import shutil
import sys

from app.config import settings
from app.database import SessionLocal
from app.storage import cleanup_orphan_files, ensure_directories, verify_storage


async def run_verify_storage() -> int:
    ensure_directories()
    async with SessionLocal() as session:
        errors = await verify_storage(session)
    if shutil.which(settings.ffmpeg_path) is None:
        errors.append(f"ffmpeg not found: {settings.ffmpeg_path}")
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print("Storage verification passed.")
    return 0


async def run_cleanup_orphans(dry_run: bool) -> int:
    ensure_directories()
    async with SessionLocal() as session:
        orphans = await cleanup_orphan_files(session, dry_run=dry_run)
    if not orphans:
        print("No orphan files found.")
        return 0
    print("Orphan files:")
    for path in orphans:
        print(f"- {path}")
    if dry_run:
        print("Dry run: no files were deleted.")
    else:
        print(f"Deleted {len(orphans)} orphan file(s).")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("verify-storage")
    cleanup = subparsers.add_parser("cleanup-orphans")
    cleanup.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.command == "verify-storage":
        return asyncio.run(run_verify_storage())
    return asyncio.run(run_cleanup_orphans(args.dry_run))


if __name__ == "__main__":
    sys.exit(main())
