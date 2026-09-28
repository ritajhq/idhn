import { join } from '@std/path'
import { UntarStream } from '@std/tar/untar-stream'

/** What the `opa` CLI reported when it refused a set of policies. */
export class OpaError extends Error {}

/**
 * The `opa` CLI, run as a subprocess: the reference Rego toolchain, which
 * checks and tests policies and compiles them to the WASM bundle judges
 * evaluate.
 */
export class Opa {
  constructor(private readonly executable: string = 'opa') {}

  /** Parse and type-check every policy in `dir`. Throws `OpaError` with opa's report. */
  async check(dir: string): Promise<void> {
    await this.run(['check', '--strict', dir])
  }

  /** Run the `test_` rules of every `*_test.rego` in `dir`. Throws `OpaError` with the failures. */
  async test(dir: string): Promise<void> {
    await this.run(['test', dir])
  }

  /** Compile `dir` into a WASM module with one entrypoint per rule path in `entrypoints` (`portal/admin/allow`). */
  async build(dir: string, entrypoints: readonly string[]): Promise<Uint8Array> {
    const out = await Deno.makeTempDir()
    try {
      const archive = join(out, 'bundle.tar.gz')
      await this.run([
        'build',
        '-t',
        'wasm',
        ...entrypoints.flatMap((entrypoint) => ['-e', entrypoint]),
        dir,
        '-o',
        archive,
      ])
      return await this.wasmIn(archive)
    } finally {
      await Deno.remove(out, { recursive: true })
    }
  }

  /** The `policy.wasm` module inside an opa bundle archive. */
  private async wasmIn(archive: string): Promise<Uint8Array> {
    const file = await Deno.open(archive)
    const entries = file.readable
      .pipeThrough(new DecompressionStream('gzip'))
      .pipeThrough(new UntarStream())
    for await (const entry of entries) {
      if (entry.path.replace(/^\/+/, '') === 'policy.wasm') {
        return new Uint8Array(await new Response(entry.readable).arrayBuffer())
      }
      await entry.readable?.cancel()
    }
    throw new OpaError('opa build produced no policy.wasm')
  }

  private async run(args: string[]): Promise<void> {
    const { success, stdout, stderr } = await new Deno.Command(
      this.executable,
      { args, stdout: 'piped', stderr: 'piped' },
    ).output()
    if (!success) {
      const report = new TextDecoder().decode(stderr).trim() ||
        new TextDecoder().decode(stdout).trim()
      throw new OpaError(`opa ${args[0]} failed:\n${report}`)
    }
  }
}
