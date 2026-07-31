# A single-stack, no-context demo of the full authorization pipeline:
# guard-proxy (public) -> judge-server (private) -> fake-service (the
# "protected" upstream). Deliberately flat compared to workflows/deploy/ —
# one stack, no infrastructure/services module split, no per-environment
# contexts/ — since this exists purely for local manual testing, not a real
# deployment target.

terraform {
  required_providers {
    dockercompose = { source = "ritaj/dockercompose" }
  }
}

provider "dockercompose" {}

locals {
  # Bind-mounted read-only into judge-server/guard-proxy so manifest/policy/
  # 403-page edits take effect without rebuilding an image — only the
  # compiled main.js is baked in, these fixtures stay on the host.
  demo_dir = "${var.workspace}/source/apps/guard/demo"
}

resource "dockercompose_stack" "demo" {
  name = "mithaq-demo"

  network {
    name = "mithaq-demo"
  }

  volume {
    name = "judge-kv"
  }

  service {
    name           = "fake-service"
    image          = "guard/fake-service:latest"
    container_name = "mithaq-demo-fake-service"
    networks       = ["mithaq-demo"]

    environment = {
      PORT = "9100"
    }

    ports = ["9100:9100"]
  }

  service {
    name           = "judge-server"
    image          = "judge/server:latest"
    container_name = "mithaq-demo-judge-server"
    networks       = ["mithaq-demo"]

    environment = {
      POLICY_BUNDLE_PATH = "/demo/policy.wasm"
      JUDGE_PORT         = "8081"
      KV_PATH            = "/kv/policies.db"
    }

    volumes = [
      "${local.demo_dir}:/demo:ro",
      "judge-kv:/kv",
    ]

    ports = ["9300:8081"]
  }

  service {
    name           = "guard-proxy"
    image          = "guard/proxy:latest"
    container_name = "mithaq-demo-guard-proxy"
    networks       = ["mithaq-demo"]

    environment = {
      SERVICE_MANIFEST_PATH = "/demo/manifest.yaml"
      JUDGE_SERVER_URL      = "http://mithaq-demo-judge-server:8081"
      UPSTREAM_URL          = "http://mithaq-demo-fake-service:9100"
      REJECT_RESPONSE_URL   = "file:///demo/forbidden.html"
      PROXY_PORT            = "8080"
    }

    volumes = [
      "${local.demo_dir}:/demo:ro",
    ]

    ports = ["9200:8080"]

    # No depends_on: guard-proxy only reaches judge-server/fake-service
    # per-request via fetch(), it doesn't connect eagerly at startup — same
    # reasoning as the deploy reference's admin-server/dashboard-api (no
    # start-ordering requirement).
  }
}
