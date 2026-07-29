#!/bin/sh
# Regenerates the .wasm fixtures in this directory from their .rego sources.
# Requires the `opa` CLI (https://www.openpolicyagent.org/docs/#running-opa).
set -eu
cd "$(dirname "$0")"

build() {
  package_path="$1"
  name="$2"
  entrypoint="$(echo "$package_path" | tr . /)/allow"

  tmp="$(mktemp -d)"
  opa build -t wasm -e "$entrypoint" "$name.rego" -o "$tmp/bundle.tar.gz"
  tar xzf "$tmp/bundle.tar.gz" -C "$tmp"
  mv "$tmp/policy.wasm" "$name.wasm"
  rm -rf "$tmp"
}

build invoice.approve invoice-approve
build invoice.neutral invoice-neutral
