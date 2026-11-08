import hashlib
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from backup import backup, verify


class BackupTests(unittest.TestCase):
    def test_online_wal_backup_and_isolated_readback(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.sqlite"
            destination = Path(directory) / "backup.sqlite"
            with sqlite3.connect(source) as current:
                current.execute("PRAGMA journal_mode=WAL")
                current.execute("CREATE TABLE cvs(sha256 TEXT,pdf BLOB)")
                pdf = b"Synthetic blob for backup test only"
                current.execute("INSERT INTO cvs VALUES(?,?)", (hashlib.sha256(pdf).hexdigest(), pdf))
                current.commit()
                backup(source, destination)
                self.assertEqual(os.stat(destination).st_mode & 0o777, 0o600)
                with sqlite3.connect(destination) as restored:
                    self.assertEqual(verify(restored), 1)
                    self.assertEqual(restored.execute("SELECT pdf FROM cvs").fetchone()[0], pdf)
                with self.assertRaises(ValueError):
                    backup(source, destination)

    def test_bad_blob_hash_rejects_and_removes_destination(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.sqlite"
            destination = Path(directory) / "backup.sqlite"
            with sqlite3.connect(source) as current:
                current.execute("CREATE TABLE cvs(sha256 TEXT,pdf BLOB)")
                current.execute("INSERT INTO cvs VALUES('incorrect',X'01')")
                current.commit()
            with self.assertRaises(ValueError):
                backup(source, destination)
            self.assertFalse(destination.exists())
