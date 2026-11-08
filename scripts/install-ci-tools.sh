#!/bin/sh
set -eu
[ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ]
track_tools_dir=$(mktemp -d "${RUNNER_TEMP:-/tmp}/trackapplyeasy-tools.XXXXXX")
curl --fail --silent --show-error --location https://get.helm.sh/helm-v4.3.1-linux-amd64.tar.gz --output "$track_tools_dir/helm.tar.gz"
printf '%s  %s\n' 0403a88ae20913d11b10a2467b50087721fea7581736da6b9d3992f5357fe54b "$track_tools_dir/helm.tar.gz" | sha256sum --check
tar -xzf "$track_tools_dir/helm.tar.gz" -C "$track_tools_dir" linux-amd64/helm
mv "$track_tools_dir/linux-amd64/helm" "$track_tools_dir/helm"
printf '%s\n' "$track_tools_dir" >> "$GITHUB_PATH"
