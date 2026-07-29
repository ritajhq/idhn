import { loadPolicy } from '@open-policy-agent/opa-wasm'
import {
  type Context,
  type Policy,
  type PolicyEngine,
  PolicyResult,
  Verdict,
} from '@mithaq/judge'

/**
 * Evaluates policies via OPA bundles compiled to WASM (`opa build -t wasm`)
 * and loaded in-process — no subprocess, no network call during evaluation.
 *
 * Each `Policy` is treated as a Rego package path whose `allow` rule decides
 * the verdict (e.g. `Policy("invoice.approve")` queries
 * `data.invoice.approve.allow`). OPA-WASM compiles one entrypoint per bundle,
 * so this engine holds a registry of already-loaded WASM policies keyed by
 * policy id, built once at construction and evaluated by lookup thereafter.
 *
 * Impure builtins like `http.send` are not wired up: evaluation must stay a
 * pure function of `(Policy, Context)`, with any external data already
 * gathered into `Context` before evaluation. A policy calling such a builtin
 * will fail at evaluation time rather than silently making a network call.
 */
export class OpaPolicyEngine implements PolicyEngine {
  private constructor(
    private readonly policies: ReadonlyMap<string, WasmPolicy>,
  ) {}

  static async load(
    bundles: ReadonlyMap<Policy, Uint8Array>,
  ): Promise<OpaPolicyEngine> {
    const entries = await Promise.all(
      Array.from(bundles, async ([policy, wasmBytes]) => {
        const wasmPolicy = await loadPolicy(wasmBytes)
        return [policy.id, wasmPolicy] as const
      }),
    )
    return new OpaPolicyEngine(new Map(entries))
  }

  // deno-lint-ignore require-await
  async evaluate(policy: Policy, context: Context): Promise<PolicyResult> {
    const wasmPolicy = this.policies.get(policy.id)
    if (wasmPolicy === undefined) {
      throw new PolicyNotLoadedError(
        `No WASM bundle was loaded for policy "${policy.id}"`,
      )
    }

    const results = wasmPolicy.evaluate(context.facts) as EvaluationResult[]
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
  evaluate(input: unknown): unknown
}

export class PolicyNotLoadedError extends Error {}
