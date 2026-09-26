import { match as compilePathMatch } from 'path-to-regexp'
import type { HeaderCriterion, Match } from './schema.ts'

/** The result of successfully matching a request against a `Match`: any path params it captured. */
export interface MatchResult {
  pathParams: Record<string, string>
}

/** Tests `request` against `match`, returning captured path params on success or `null` on no match. */
export function matchRequest(
  match: Match,
  request: Request,
): MatchResult | null {
  if (!matchesMethod(match.method, request.method)) {
    return null
  }

  const pathParams = matchPath(match.path, new URL(request.url).pathname)
  if (pathParams === null) {
    return null
  }

  if (
    match.header !== undefined && !matchesHeader(match.header, request.headers)
  ) {
    return null
  }

  return { pathParams }
}

function matchesMethod(expected: string | string[], actual: string): boolean {
  const methods = Array.isArray(expected) ? expected : [expected]
  return methods.some((method) => method.toUpperCase() === actual.toUpperCase())
}

function matchPath(
  pattern: string | string[],
  pathname: string,
): Record<string, string> | null {
  const fn = compilePathMatch(pattern)
  const result = fn(pathname)
  if (result === false) {
    return null
  }
  return result.params as Record<string, string>
}

function matchesHeader(
  expected: string | string[] | HeaderCriterion[],
  headers: Headers,
): boolean {
  const criteria = normalizeHeaderCriteria(expected)
  return criteria.every((criterion) => {
    const actual = headers.get(criterion.name)
    if (actual === null) {
      return false
    }
    return criterion.value === undefined || actual === criterion.value
  })
}

function normalizeHeaderCriteria(
  expected: string | string[] | HeaderCriterion[],
): HeaderCriterion[] {
  if (typeof expected === 'string') {
    return [{ name: expected }]
  }
  return expected.map((
    item,
  ) => (typeof item === 'string' ? { name: item } : item))
}
