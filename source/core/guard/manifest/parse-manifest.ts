import type {
  BodyType,
  ExtractEntry,
  From,
  FromProperty,
  HeaderCriterion,
  Manifest,
  ManifestAction,
  Match,
} from './schema.ts'

export class ManifestParseError extends Error {}

const BODY_TYPES: readonly BodyType[] = ['json', 'form', 'text']
const FROM_PROPERTIES: readonly FromProperty[] = [
  'path',
  'query',
  'header',
  'body',
  'constant',
]

/** Parses and validates a raw (already YAML/JSON-decoded) value as a `Manifest`. Throws `ManifestParseError` on any structural problem. */
export function parseManifest(raw: unknown): Manifest {
  const root = expectObject(raw, 'manifest')
  const id = expectString(root.id, 'manifest.id')
  const actions = expectArray(root.actions, 'manifest.actions').map((
    action,
    index,
  ) => parseAction(action, `manifest.actions[${index}]`))
  return { id, actions }
}

function parseAction(raw: unknown, path: string): ManifestAction {
  const obj = expectObject(raw, path)
  const name = expectString(obj.name, `${path}.name`)
  const match = parseMatch(obj.match, `${path}.match`)
  const extract = obj.extract === undefined
    ? undefined
    : expectArray(obj.extract, `${path}.extract`).map((entry, index) =>
      parseExtractEntry(entry, `${path}.extract[${index}]`)
    )
  return { name, match, extract }
}

function parseMatch(raw: unknown, path: string): Match {
  const obj = expectObject(raw, path)
  const method = parseStringOrStringArray(obj.method, `${path}.method`)
  const pathPattern = parseStringOrStringArray(obj.path, `${path}.path`)
  const header = obj.header === undefined
    ? undefined
    : parseHeaderMatch(obj.header, `${path}.header`)
  return { method, path: pathPattern, header }
}

function parseHeaderMatch(
  raw: unknown,
  path: string,
): string | string[] | HeaderCriterion[] {
  if (typeof raw === 'string') {
    return raw
  }
  if (Array.isArray(raw)) {
    if (raw.every((item) => typeof item === 'string')) {
      return raw as string[]
    }
    return raw.map((item, index) =>
      parseHeaderCriterion(item, `${path}[${index}]`)
    )
  }
  throw new ManifestParseError(
    `${path} must be a string, an array of strings, or an array of {name, value} objects`,
  )
}

function parseHeaderCriterion(raw: unknown, path: string): HeaderCriterion {
  const obj = expectObject(raw, path)
  const name = expectString(obj.name, `${path}.name`)
  const value = obj.value === undefined
    ? undefined
    : expectString(obj.value, `${path}.value`)
  return { name, value }
}

function parseExtractEntry(raw: unknown, path: string): ExtractEntry {
  const obj = expectObject(raw, path)
  const from = parseFrom(obj.from, `${path}.from`)
  const as = expectString(obj.as, `${path}.as`)
  const optional = obj.optional === undefined
    ? undefined
    : expectBoolean(obj.optional, `${path}.optional`)
  return { from, as, optional }
}

function parseFrom(raw: unknown, path: string): From {
  const obj = expectObject(raw, path)
  const property = expectOneOf(
    obj.property,
    FROM_PROPERTIES,
    `${path}.property`,
  )
  const using = expectString(obj.using, `${path}.using`)
  const type = obj.type === undefined
    ? undefined
    : expectOneOf(obj.type, BODY_TYPES, `${path}.type`)
  if (type !== undefined && property !== 'body') {
    throw new ManifestParseError(
      `${path}.type is only meaningful when property is "body"`,
    )
  }
  return { property, using, type }
}

function parseStringOrStringArray(
  raw: unknown,
  path: string,
): string | string[] {
  if (typeof raw === 'string') {
    return raw
  }
  if (Array.isArray(raw) && raw.every((item) => typeof item === 'string')) {
    return raw as string[]
  }
  throw new ManifestParseError(
    `${path} must be a string or an array of strings`,
  )
}

function expectObject(raw: unknown, path: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ManifestParseError(`${path} must be an object`)
  }
  return raw as Record<string, unknown>
}

function expectArray(raw: unknown, path: string): unknown[] {
  if (!Array.isArray(raw)) {
    throw new ManifestParseError(`${path} must be an array`)
  }
  return raw
}

function expectString(raw: unknown, path: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new ManifestParseError(`${path} must be a non-empty string`)
  }
  return raw
}

function expectBoolean(raw: unknown, path: string): boolean {
  if (typeof raw !== 'boolean') {
    throw new ManifestParseError(`${path} must be a boolean`)
  }
  return raw
}

function expectOneOf<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (
    typeof raw !== 'string' || !(allowed as readonly string[]).includes(raw)
  ) {
    throw new ManifestParseError(
      `${path} must be one of: ${allowed.join(', ')}`,
    )
  }
  return raw as T
}
