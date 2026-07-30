#!/bin/sh
# Regenerates policy.wasm in this directory from the .rego sources here.
# Requires the `opa` CLI (https://www.openpolicyagent.org/docs/#running-opa).
#
# All fixture policies compile into a single bundle, matching how a real
# policy repo's entire .rego tree becomes one policy.wasm with multiple
# entrypoints — one per policy, selected by name at evaluation time.
set -eu
cd "$(dirname "$0")"

tmp="$(mktemp -d)"
opa build -t wasm \
  -e invoice/approve/allow \
  -e invoice/neutral/allow \
  ./*.rego \
  -o "$tmp/bundle.tar.gz"
tar xzf "$tmp/bundle.tar.gz" -C "$tmp"
mv "$tmp/policy.wasm" policy.wasm
rm -rf "$tmp"
