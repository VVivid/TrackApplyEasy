#!/usr/bin/env python3
"""Publish a new immutable-by-policy image/chart version; never mutate GitOps."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from registry import digest

IMAGE = "vvivid/trackapplyeasy"
CHART = "vvivid/charts/trackapplyeasy"


def command(*args):
    subprocess.run(args, check=True)


def publish(version, output):
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise ValueError("Use a vX.Y.Z release tag")
    source_sha = os.environ["GITHUB_SHA"]
    source_ref = os.environ["GITHUB_REF"]
    if source_ref != "refs/tags/v" + version or not re.fullmatch(r"[a-f0-9]{40}", source_sha):
        raise ValueError("Publication must run from its exact version tag")
    command("git", "merge-base", "--is-ancestor", source_sha, "origin/main")
    if digest(IMAGE, version, True) or digest(CHART, version, True):
        raise ValueError("Version already published; use a new version, never overwrite artifacts")
    command("docker", "build", "--platform", "linux/amd64", "--tag", "ghcr.io/" + IMAGE + ":" + version,
            "--label", "org.opencontainers.image.source=https://github.com/VVivid/TrackApplyEasy",
            "--label", "org.opencontainers.image.revision=" + source_sha,
            "--label", "org.opencontainers.image.version=" + version, ".")
    command("python3", "scripts/check-container.py", "--image", "ghcr.io/" + IMAGE + ":" + version)
    command("docker", "push", "ghcr.io/" + IMAGE + ":" + version)
    with tempfile.TemporaryDirectory() as temporary:
        command("helm", "package", "deploy/helm/trackapplyeasy", "--version", version, "--app-version", version, "--destination", temporary)
        command("helm", "push", str(Path(temporary) / ("trackapplyeasy-" + version + ".tgz")), "oci://ghcr.io/vvivid/charts")
    record = {"version": version, "sourceCommit": source_sha, "sourceRef": source_ref,
              "imageDigest": digest(IMAGE, version, True), "chartDigest": digest(CHART, version, True),
              "workflowRun": "https://github.com/VVivid/TrackApplyEasy/actions/runs/" + os.environ["GITHUB_RUN_ID"]}
    if not all(record.values()):
        raise RuntimeError("Published artifacts could not be read back")
    output.write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps(record, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    publish(args.version, args.output)
