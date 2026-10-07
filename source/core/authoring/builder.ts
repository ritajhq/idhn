import { TarStream, type TarStreamInput } from '@std/tar/tar-stream'

/** The policy builder could not be reached, or answered in a way it never does. */
export class BuilderUnavailableError extends Error {}

/** The header the builder reads a source tree's version from. */
const VERSION_HEADER = 'x-policy-version'

/** How long to wait for the builder, which checks, tests and compiles before it answers. */
const DEFAULT_TIMEOUT_MS = 60_000

/**
 * The policy builder, over HTTP: a source tree, sent as a tar, is checked
 * without publishing (`POST /checks`) or published for judges to pull
 * (`PUT /sources`). Either way the answer is every problem that stopped it
 * building — none when it built.
 */
export class Builder {
  constructor(
    private readonly url: URL,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  /** Every reason `files` wouldn't build. Throws `BuilderUnavailableError`. */
  check(
    files: Readonly<Record<string, string>>,
    version: string,
  ): Promise<string[]> {
    return this.send('POST', '/checks', files, version)
  }

  /** Publishes `files` as `version` if they build; every reason they don't, otherwise. Throws `BuilderUnavailableError`. */
  publish(
    files: Readonly<Record<string, string>>,
    version: string,
  ): Promise<string[]> {
    return this.send('PUT', '/sources', files, version)
  }

  private async send(
    method: string,
    path: string,
    files: Readonly<Record<string, string>>,
    version: string,
  ): Promise<string[]> {
    let answer: Response
    try {
      answer = await fetch(new URL(path, this.url), {
        method,
        headers: { [VERSION_HEADER]: version },
        body: await this.tarOf(files),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new BuilderUnavailableError(
        `The policy builder at ${this.url.origin} could not be reached`,
        { cause: error },
      )
    }
    if (answer.status !== 200 && answer.status !== 422) {
      const said = await answer.text()
      throw new BuilderUnavailableError(
        `The policy builder answered ${answer.status}: ${said}`,
      )
    }
    const { problems } = await answer.json() as { problems?: string[] }
    return problems ?? []
  }

  private async tarOf(
    files: Readonly<Record<string, string>>,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const entries: TarStreamInput[] = Object.entries(files).map(
      ([path, content]) => {
        const bytes = new TextEncoder().encode(content)
        return {
          type: 'file',
          path,
          size: bytes.length,
          readable: ReadableStream.from([bytes]),
        }
      },
    )
    return new Uint8Array(
      await new Response(
        ReadableStream.from(entries).pipeThrough(new TarStream()),
      )
        .arrayBuffer(),
    )
  }
}
