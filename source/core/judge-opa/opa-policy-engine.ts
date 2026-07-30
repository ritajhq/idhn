import { loadPolicy } from '@open-policy-agent/opa-wasm'
import {
  type Context,
  type Policy,
  type PolicyEngine,
  PolicyResult,
  Verdict,
} from '@mithaq/judge'

/**
 * Evaluates policies via a single OPA bundle compiled to WASM
 * (`opa build -t wasm`) and loaded in-process — no subprocess, no network
 * call during evaluation. A policy repo's entire `.rego` tree compiles down
 * to one `policy.wasm` module with multiple entrypoints baked in, so one
 * `OpaPolicyEngine` — backed by one loaded module — can evaluate every
 * policy in the bundle; which entrypoint runs is selected per call.
 *
 * Each `Policy` is treated as a Rego package path whose `allow` rule decides
 * the verdict (e.g. `Policy("invoice.approve")` selects the entrypoint
 * `invoice/approve/allow`, which must have been included via `-e` when the
 * bundle was built).
 *
 * Impure builtins like `http.send` are not wired up: evaluation must stay a
 * pure function of `(Policy, Context)`, with any external data already
 * gathered into `Context` before evaluation. A policy calling such a builtin
 * will fail at evaluation time rather than silently making a network call.
 */
export class OpaPolicyEngine implements PolicyEngine {
  private constructor(private readonly wasmPolicy: WasmPolicy) {}

  static async load(wasmBytes: Uint8Array): Promise<OpaPolicyEngine> {
    const wasmPolicy = await loadPolicy(wasmBytes)
    return new OpaPolicyEngine(wasmPolicy)
  }

  // deno-lint-ignore require-await
  async evaluate(policy: Policy, context: Context): Promise<PolicyResult> {
    const entrypoint = `${policy.id.replaceAll('.', '/')}/allow`

    if (!Object.hasOwn(this.wasmPolicy.entrypoints, entrypoint)) {
      throw new EntrypointNotFoundError(
        `No entrypoint "${entrypoint}" in the loaded OPA bundle for policy "${policy.id}"`,
      )
    }

    const results = this.wasmPolicy.evaluate(
      context.facts,
      entrypoint,
    ) as EvaluationResult[]
    return new PolicyResult(policy, toVerdict(results))
  }
}

function toVerdict(results: EvaluationResult[]): Verdict {
  if (results.length === 0) {
    return Verdict.Neutral
  }
  return results[0].result === true ? Verdict.Allow : Verdict.Deny
}

interface EvaluationResult {
  result: unknown
}

interface WasmPolicy {
  entrypoints: Record<string, number>
  evaluate(input: unknown, entrypoint?: string | number): unknown
}

export class EntrypointNotFoundError extends Error {}
