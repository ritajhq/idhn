import { loadPolicy } from '@open-policy-agent/opa-wasm'
import type * as Access from '@idhn/access'
import * as Policy from '@idhn/policy'

/**
 * Evaluates policies via a single OPA bundle compiled to WASM
 * (`opa build -t wasm`) and loaded in-process — no subprocess, no network
 * call during evaluation. A policy repo's entire `.rego` tree compiles down
 * to one `policy.wasm` module with multiple entrypoints baked in, so one
 * `PolicyEngine` — backed by one loaded module — can evaluate every
 * policy in the bundle; which entrypoint runs is selected per call.
 *
 * Each `Policy.Identifier` is treated as a Rego package path whose `allow` rule decides
 * the verdict (e.g. `Policy.Identifier("invoice.approve")` selects the entrypoint
 * `invoice/approve/allow`, which must have been included via `-e` when the
 * bundle was built).
 *
 * Impure builtins like `http.send` are not wired up: evaluation must stay a
 * pure function of `(Policy.Identifier, Access.Context)`, with any external data already
 * gathered into `Context` before evaluation. A policy calling such a builtin
 * will fail at evaluation time rather than silently making a network call.
 */
export class PolicyEngine implements Policy.Engine {
  private constructor(private readonly wasmPolicy: WasmPolicy) {}

  /**
   * `data` is Rego's `data` document: slow-changing reference data (an
   * allow-list, a tier table) that policies read as `data.<key>` without any
   * lookup at evaluation time. It is fixed for the engine's lifetime — a
   * change means loading a new engine, the same as a changed bundle.
   */
  static async load(
    wasmBytes: Uint8Array,
    data: Record<string, unknown> = {},
  ): Promise<PolicyEngine> {
    const wasmPolicy = await loadPolicy(wasmBytes)
    wasmPolicy.setData(data)
    return new PolicyEngine(wasmPolicy)
  }

  // deno-lint-ignore require-await
  async evaluate(
    policy: Policy.Identifier,
    context: Access.Context,
  ): Promise<Policy.Result> {
    const entrypoint = [...policy.segments, 'allow'].join('/')

    if (!Object.hasOwn(this.wasmPolicy.entrypoints, entrypoint)) {
      throw new EntrypointNotFoundError(
        `No entrypoint "${entrypoint}" in the loaded OPA bundle for policy "${policy}"`,
      )
    }

    const results = this.wasmPolicy.evaluate(
      context.facts,
      entrypoint,
    ) as EvaluationResult[]
    return new Policy.Result(policy, toVerdict(results))
  }
}

function toVerdict(results: EvaluationResult[]): Policy.Verdict {
  if (results.length === 0) {
    return Policy.Verdict.Neutral
  }
  return results[0].result === true ? Policy.Verdict.Allow : Policy.Verdict.Deny
}

interface EvaluationResult {
  result: unknown
}

interface WasmPolicy {
  entrypoints: Record<string, number>
  evaluate(input: unknown, entrypoint?: string | number): unknown
  setData(data: unknown): void
}

export class EntrypointNotFoundError extends Error {}
