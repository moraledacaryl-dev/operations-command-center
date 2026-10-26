#!/usr/bin/env python3
"""Validate the file layout of a portable synthetic training artifact."""
from __future__ import annotations
import argparse
from pathlib import Path
import re

REQUIRED = (
    "commit.sha", "backend/alembic.ini", "backend/requirements.txt",
    "backend/app/main.py", "backend/scripts/seed_training_demo.py",
    "frontend/standalone/server.js", "frontend/standalone/.next/static",
    "deployment/training-native/install-first.sh",
    "deployment/training-native/verify-only.sh",
    "wheelhouse",
)

def validate(root: Path) -> str:
    root = root.resolve(strict=True)
    sha = (root / "commit.sha").read_text(encoding="ascii").strip()
    if not re.fullmatch(r"[a-f0-9]{40}", sha):
        raise RuntimeError("Invalid commit SHA in training artifact")
    for rel in REQUIRED:
        path = root / rel
        if not path.exists() or path.is_symlink():
            raise RuntimeError("Missing/unsafe training artifact path: " + rel)
        if not path.resolve().is_relative_to(root):
            raise RuntimeError("Training path escapes artifact root: " + rel)
    if not list((root / "wheelhouse").glob("*.whl")):
        raise RuntimeError("Missing offline Python wheelhouse")
    return sha

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        import tempfile
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for rel in REQUIRED:
                path = root / rel
                if rel.endswith(("static", "wheelhouse")): path.mkdir(parents=True)
                elif rel != "commit.sha":
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text("demo", encoding="utf-8")
            (root / "commit.sha").write_text("1" * 40, encoding="ascii")
            (root / "wheelhouse" / "example.whl").write_text("demo")
            assert validate(root) == "1" * 40
            (root / "commit.sha").write_text("unsafe", encoding="ascii")
            try:
                validate(root)
            except RuntimeError:
                pass
            else:
                raise AssertionError("Bad SHA accepted")
        print("PASS: portable training archive manifest checks")
        return
    if not args.directory:
        parser.error("--directory required unless --self-test is set")
    print("PASS: synthetic training artifact", validate(args.directory))

if __name__ == "__main__":
    main()
