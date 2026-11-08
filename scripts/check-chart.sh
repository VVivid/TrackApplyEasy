#!/bin/sh
set -eu
helm_bin=${HELM:-helm}
chart=deploy/helm/trackapplyeasy
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
cat > "$scratch/valid.yaml" <<'YAML'
configured: true
image:
  digest: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
provenance:
  sourceCommit: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
routes:
  publicEnabled: true
  publicCertificateReady: true
  privateEnabled: true
  privateCertificateReady: true
YAML
"$helm_bin" lint "$chart" -f "$scratch/valid.yaml"
"$helm_bin" template trackapplyeasy "$chart" -n trackapplyeasy -f "$scratch/valid.yaml" > "$scratch/rendered.yaml"
for invalid in 'replicaCount=2' 'image.digest=latest' 'routes.publicCertificateReady=false' 'routes.privateCertificateReady=false' 'mcp.mode=direct' 'origins.public=https://evil.example.test' 'storage.storageClass=local-path'; do
 if "$helm_bin" template trackapplyeasy "$chart" -f "$scratch/valid.yaml" --set "$invalid" > /dev/null 2>&1; then
  echo "ERROR: chart accepted $invalid" >&2; exit 1
 fi
done
if "$helm_bin" template trackapplyeasy "$chart" >/dev/null 2>&1; then echo 'ERROR: unconfigured chart rendered' >&2; exit 1; fi
python3 - "$scratch/rendered.yaml" <<'PY'
import sys
text=open(sys.argv[1]).read()
assert 'type: Recreate' in text and 'replicas: 1' in text
assert 'Path(`/mcp`)' not in text and 'PathPrefix(`/mcp`)' not in text
assert 'entryPoints: [websecure]' in text and 'entryPoints: [platform-tls]' in text
assert 'helm.sh/resource-policy: keep' in text
assert 'allowPrivilegeEscalation: false' in text
print('Chart safety and negative configuration checks passed.')
PY
