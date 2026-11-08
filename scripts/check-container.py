#!/usr/bin/env python3
"""Exercise the real nonroot image's private-file and SQLite CLI paths locally."""
import argparse
import base64
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tarfile
import tempfile


def docker(*args, input=None):
    command = ["docker"]
    if os.environ.get("DOCKER_CONTEXT"):
        command += ["--context", os.environ["DOCKER_CONTEXT"]]
    return subprocess.run(command + list(args), input=input, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True).stdout


def archive(files):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w") as tar:
        for name, content, mode, uid, gid in files:
            info = tarfile.TarInfo(name)
            info.size, info.mode, info.uid, info.gid = len(content), mode, uid, gid
            tar.addfile(info, io.BytesIO(content))
    return output.getvalue()


def run(image):
    metadata = json.loads(docker("image", "inspect", image))[0]
    if metadata["Config"]["User"] != "65532:65532":
        raise ValueError("Runtime must use the nonroot app UID/GID")
    containers = []
    try:
        keygen = docker("create", image, "-keygen-file=/tmp/session-keys.json").decode().strip()
        containers.append(keygen)
        docker("start", "--attach", keygen)
        key_archive = docker("cp", keygen + ":/tmp/session-keys.json", "-")
        with tarfile.open(fileobj=io.BytesIO(key_archive)) as tar:
            key_file = tar.getmembers()[0]
            if key_file.mode != 0o600 or key_file.uid != 65532:
                raise ValueError("Generated key file ownership/mode differs")
            keyring = json.load(tar.extractfile(key_file))
            if len(base64.b64decode(keyring["keys"][keyring["active"]])) != 32:
                raise ValueError("Generated AES key is invalid")
        enrollment = json.dumps({"issuer": "https://issuer.example.test", "subject": "synthetic-container-owner", "label": "Synthetic container owner"}).encode()
        data = docker("create", image, "-db=/tmp/app.sqlite", "-enroll-file=/tmp/enrollment.json").decode().strip()
        containers.append(data)
        docker("cp", "-a", "-", data + ":/tmp", input=archive([("enrollment.json", enrollment, 0o600, 65532, 65532)]))
        docker("start", "--attach", data)
        docker("start", "--attach", data)
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "app.sqlite"
            docker("cp", data + ":/tmp/app.sqlite", str(path))
            with sqlite3.connect(path) as connection:
                if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok" or connection.execute("SELECT count(*) FROM owners").fetchone()[0] != 1:
                    raise ValueError("Enrollment/restart did not preserve one consistent owner")
        private = docker("create", image, "-prepare-secrets-source=/tmp/projected", "-prepare-secrets-dest=/tmp/runtime").decode().strip()
        containers.append(private)
        raw_keys = json.dumps(keyring).encode()
        docker("cp", "-a", "-", private + ":/tmp", input=archive([("projected/client-secret", b"synthetic-client-secret", 0o440, 0, 65532), ("projected/session-keys.json", raw_keys, 0o440, 0, 65532)]))
        docker("start", "--attach", private)
        copied = docker("cp", private + ":/tmp/runtime", "-")
        with tarfile.open(fileobj=io.BytesIO(copied)) as tar:
            files = [member for member in tar.getmembers() if member.isfile()]
            if len(files) != 2 or any(member.mode != 0o600 or member.uid != 65532 for member in files):
                raise ValueError("Runtime private files must be owner-only")
        print("Container checks passed: nonroot identity, owner-only key/secret files, real SQLite enrollment and repeat-start persistence.")
    finally:
        for container in containers:
            docker("rm", "--force", container)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", default="trackapplyeasy:local")
    run(parser.parse_args().image)
