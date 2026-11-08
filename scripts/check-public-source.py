#!/usr/bin/env python3
"""Reject accidental private artifacts from files Git would publish."""
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
paths = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=root).split(b"\0")
failures = []
for raw in paths:
    if not raw:
        continue
    relative = Path(raw.decode())
    item = root / relative
    if not item.is_file():
        continue
    if relative.suffix.lower() in {".pdf", ".sqlite", ".db", ".sqlite3", ".pem", ".p12", ".pfx"}:
        failures.append(str(relative))
        continue
    data = item.read_bytes()
    if b"data:application/pdf;base64," in data or b"-----BEGIN PRIVATE KEY-----" in data or b"-----BEGIN RSA PRIVATE KEY-----" in data or data.startswith(b"%PDF-"):
        # This checker describes forbidden signatures, so do not inspect itself.
        if relative != Path("scripts/check-public-source.py"):
            failures.append(str(relative))
if failures:
    sys.exit("Private artifact signatures found: " + ", ".join(failures))
print("Public source check passed: no PDF/database/private-key artifacts or embedded PDFs.")
