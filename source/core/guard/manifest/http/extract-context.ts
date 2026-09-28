import type { ExtractEntry } from './schema.ts'
import type { MatchResult } from './match-request.ts'

/** Reads a request's body once and caches the parse of each supported type, since a `Request` body can only be consumed once. */
class BodyReader {
  private text: Promise<string> | undefined

  constructor(private readonly request: Request) {}

  private readText(): Promise<string> {
    this.text ??= this.request.text()
    return this.text
  }

  async read(type: 'json' | 'form' | 'text'): Promise<unknown> {
    const text = await this.readText()
    if (text.length === 0) {
      return undefined
    }
    switch (type) {
      case 'text':
        return text
      case 'json':
        return JSON.parse(text)
      case 'form':
        return Object.fromEntries(new URLSearchParams(text))
    }
  }
}

/**
 * Extracts `entries` into a plain fact object, given a request and the path
 * params captured while matching it. Returns `null` if a non-optional
 * `query`/`header`/`body` entry has no value in the request — the caller
 * should treat that the same as the action not matching at all.
 */
export async function extractContext(
  entries: readonly ExtractEntry[],
  request: Request,
  matchResult: MatchResult,
): Promise<Record<string, unknown> | null> {
  const url = new URL(request.url)
  const body = new BodyReader(request)
  const facts: Record<string, unknown> = {}

  for (const entry of entries) {
    const value = await extractOne(entry, request, url, matchResult, body)
    if (value === MISSING) {
      if (entry.optional === true) {
        continue
      }
      return null
    }
    facts[entry.as] = value
  }

  return facts
}

const MISSING = Symbol('missing')

async function extractOne(
  entry: ExtractEntry,
  request: Request,
  url: URL,
  matchResult: MatchResult,
  body: BodyReader,
): Promise<unknown | typeof MISSING> {
  const { from } = entry
  switch (from.property) {
    case 'constant':
      return from.using
    case 'path':
      return matchResult.pathParams[from.using] ?? MISSING
    case 'query': {
      const value = url.searchParams.get(from.using)
      return value ?? MISSING
    }
    case 'header': {
      const value = request.headers.get(from.using)
      return value ?? MISSING
    }
    case 'body': {
      const parsed = await body.read(from.type ?? 'text')
      if (parsed === undefined) {
        return MISSING
      }
      if (from.type === 'text') {
        return parsed
      }
      const value = getByPath(parsed, from.using)
      return value === undefined ? MISSING : value
    }
  }
}

/**
 * Reads the value at `path` within a parsed body: an RFC 6901 JSON Pointer
 * when it starts with `/` (`/data/action.place`, for keys that themselves
 * contain dots), otherwise a dot-path (`data.place`).
 */
function getByPath(value: unknown, path: string): unknown {
  const keys = path.startsWith('/') ? pointerKeys(path) : path.split('.')
  return keys.reduce<unknown>((current, key) => {
    if (current === null || typeof current !== 'object') {
      return undefined
    }
    return (current as Record<string, unknown>)[key]
  }, value)
}

/** Splits a JSON Pointer into its reference tokens, unescaping `~1` (`/`) and then `~0` (`~`). */
function pointerKeys(pointer: string): string[] {
  return pointer
    .slice(1)
    .split('/')
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'))
}
