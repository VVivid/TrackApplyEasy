#!/usr/bin/env python3
"""Take a consistent SQLite online backup, including CV blobs and encrypted sessions.

The stable session encryption keyring and OAuth secret require separate protected
recovery material. This command never prints application text, subjects or tokens.
"""
import argparse
import hashlib
import os
from pathlib import Path
import sqlite3


def verify(connection):
    if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise ValueError("SQLite integrity check failed")
    if connection.execute("PRAGMA foreign_key_check").fetchone():
        raise ValueError("SQLite foreign key check failed")
    count = 0
    for digest, pdf in connection.execute("SELECT sha256,pdf FROM cvs"):
        if hashlib.sha256(pdf).hexdigest() != digest:
            raise ValueError("CV content hash failed")
        count += 1
    return count


def backup(source, destination):
    if destination.exists():
        raise ValueError("Destination must be a new protected file")
    descriptor = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(descriptor)
    try:
        with sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True, timeout=10) as current, sqlite3.connect(destination) as target:
            current.backup(target)
            count = verify(target)
        print(f"Consistent backup verified; {count} PDF blob hashes checked. Restore acceptance remains separate.")
    except Exception:
        destination.unlink(missing_ok=True)
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    args = parser.parse_args()
    backup(args.source, args.destination)
