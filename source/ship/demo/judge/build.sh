#!/bin/sh
# Regenerates policy.wasm in this directory from policy.rego.
# Requires the `opa` CLI (https://www.openpolicyagent.org/docs/#running-opa).
set -eu
cd "$(dirname "$0")"

tmp="$(mktemp -d)"
opa build -t wasm -e demo/home/visit/allow policy.rego -o "$tmp/bundle.tar.gz"
tar xzf "$tmp/bundle.tar.gz" -C "$tmp"
mv "$tmp/policy.wasm" policy.wasm
rm -rf "$tmp"
