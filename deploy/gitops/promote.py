#!/usr/bin/env python3
"""Update release-owned fields in one fixed private Fleet file using GitHub CAS."""
import argparse
import base64
import copy
import json
import os
import re
import urllib.error
import urllib.request
from registry import digest

PATH = "environments/rd/trackapplyeasy/production/fleet.yaml"
API = "https://api.github.com/repos/VVivid/homelab-gitops/contents/" + PATH


def update(document, release):
    if document.get("defaultNamespace") != "trackapplyeasy" or document["helm"]["repo"] != "oci://ghcr.io/vvivid/charts/trackapplyeasy":
        raise ValueError("Unexpected Fleet destination; inspect before promotion")
    if not document["helm"]["values"]["configured"]:
        raise ValueError("Operator must finish identity/storage preparation before promotion")
    result = copy.deepcopy(document)
    result["helm"]["version"] = release["version"]
    result["helm"]["values"]["image"]["digest"] = release["imageDigest"]
    result["helm"]["values"]["provenance"] = {key: release[key] for key in ("sourceRef", "sourceCommit", "workflowRun")}
    result["helm"]["values"]["provenance"]["chartDigest"] = release["chartDigest"]
    return result


def github(method, body=None):
    headers = {"Authorization": "Bearer " + os.environ["GITOPS_TOKEN"], "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(API + "?ref=main", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"GitOps {method} failed with HTTP {error.code}; state was not overwritten") from None


def promote(release):
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", release["version"]) or release["sourceRef"] != "refs/tags/v" + release["version"] or not re.fullmatch(r"[a-f0-9]{40}", release["sourceCommit"]):
        raise ValueError("Invalid release identity")
    for name in ("imageDigest", "chartDigest"):
        if not re.fullmatch(r"sha256:[a-f0-9]{64}", release[name]):
            raise ValueError("Immutable artifact digests required")
    if not re.fullmatch(r"https://github.com/VVivid/TrackApplyEasy/actions/runs/[0-9]+", release["workflowRun"]):
        raise ValueError("Publication workflow provenance required")
    # Anonymous requests are intentional. GHCR packages start private even when
    # their source repository is public; Fleet receives no GHCR credentials.
    if digest("vvivid/trackapplyeasy", release["version"]) != release["imageDigest"] or digest("vvivid/charts/trackapplyeasy", release["version"]) != release["chartDigest"]:
        raise ValueError("Anonymous image/chart read-back differs or is unavailable; do not enroll Fleet")
    current = github("GET")
    document = json.loads(base64.b64decode(current["content"]))
    result = update(document, release)
    if result == document:
        print("Desired release is already recorded.")
        return
    github("PUT", {"message": "Promote TrackApplyEasy v" + release["version"], "branch": "main", "sha": current["sha"], "content": base64.b64encode((json.dumps(result, indent=2) + "\n").encode()).decode()})
    observed = json.loads(base64.b64decode(github("GET")["content"]))
    if observed != result:
        raise RuntimeError("GitOps read-back differed; inspect concurrent state")
    print("Recorded exact image/chart provenance in " + PATH + "; deployment and business acceptance remain separate.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", required=True)
    args = parser.parse_args()
    promote(json.load(open(args.release)))
