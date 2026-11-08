"""Minimal GHCR manifest lookup; credentials stay in process memory."""
import base64
import json
import os
import urllib.error
import urllib.parse
import urllib.request

ACCEPT = ", ".join(["application/vnd.oci.image.manifest.v1+json", "application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.v2+json", "application/vnd.docker.distribution.manifest.list.v2+json"])


def digest(repository, reference, authenticated=False):
    query = urllib.parse.urlencode({"service": "ghcr.io", "scope": f"repository:{repository}:pull"})
    headers = {}
    if authenticated:
        identity = os.environ["GITHUB_ACTOR"] + ":" + os.environ["GHCR_TOKEN"]
        headers["Authorization"] = "Basic " + base64.b64encode(identity.encode()).decode()
    request = urllib.request.Request("https://ghcr.io/token?" + query, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            token = json.load(response)["token"]
        request = urllib.request.Request(f"https://ghcr.io/v2/{repository}/manifests/{reference}", method="HEAD", headers={"Authorization": "Bearer " + token, "Accept": ACCEPT})
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.headers["Docker-Content-Digest"]
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise RuntimeError(f"GHCR lookup failed with HTTP {error.code}; no publication or promotion is safe") from None
