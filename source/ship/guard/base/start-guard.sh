#!/bin/sh
# Launches guard in the background so a consumer's own CMD can exec its
# service in the foreground. Judge runs in-process (no separate judge
# process/port) — env contract is SERVICE_MANIFEST_PATH, POLICY_BUNDLE_PATH,
# POLICY_REGISTRY_PATH, UPSTREAM_URL, REJECT_RESPONSE_URL, PROXY_PORT — set
# them before running this.
set -eu

deno run --allow-net --allow-read --allow-write --allow-env /opt/guard/main.js &
