import * as Disclosure from '@idhn/disclosure'
import {
  expectArray,
  expectBoolean,
  expectFactName,
  expectObject,
  expectOneOf,
  expectRegoSafeActionName,
  expectString,
  ManifestParseError,
} from '../expect.ts'
import type {
  BodyType,
  ExtractEntry,
  From,
  FromProperty,
  HeaderCriterion,
  HttpManifest,
  HttpManifestAction,
  Match,
} from './schema.ts'
import { isReserved, RESERVED_NAMESPACE } from '../reserved.ts'
import { parseHttpAuthentication } from './parse-authentication.ts'

const BODY_TYPES: readonly BodyType[] = ['json', 'form', 'text']
const FROM_PROPERTIES: readonly FromProperty[] = [
  'path',
  'query',
  'header',
  'body',
  'constant',
]

function parseAction(raw: unknown, path: string): HttpManifestAction {
  const obj = expectObject(raw, path)
  const name = expectRegoSafeActionName(obj.name, `${path}.name`)
  if (isReserved(name)) {
    throw new ManifestParseError(
      `${path}.name "${name}" is under "${RESERVED_NAMESPACE}.", which is reserved for the actions every guard answers itself`,
    )
  }
  const match = parseMatch(obj.match, `${path}.match`)
  const extract = obj.extract === undefined
    ? undefined
    : expectArray(obj.extract, `${path}.extract`).map((entry, index) =>
      parseExtractEntry(entry, `${path}.extract[${index}]`)
    )
  const restrict = obj.restrict === undefined
    ? undefined
    : parseRestrict(obj.restrict, `${path}.restrict`)
  return { name, match, extract, restrict }
}

/** `[{ field: <JSON Pointer>, show?: <presentation> }]`: each field covered unless `show` says how else. */
function parseRestrict(raw: unknown, path: string): Disclosure.Disclosure {
  const entries = expectArray(raw, path).map((entry, index) => {
    const at = `${path}[${index}]`
    const obj = expectObject(entry, at)
    try {
      return [
        Disclosure.Field.parse(obj.field, `${at}.field`),
        obj.show === undefined
          ? Disclosure.Presentation.covered
          : Disclosure.Presentation.parse(obj.show, `${at}.show`),
      ] as const
    } catch (error) {
      if (
        error instanceof Disclosure.InvalidFieldError ||
        error instanceof Disclosure.InvalidPresentationError
      ) {
        throw new ManifestParseError(error.message)
      }
      throw error
    }
  })
  return Disclosure.Disclosure.of(entries)
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
  const as = expectFactName(obj.as, `${path}.as`)
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

/** Parses the HTTP-specific part of a manifest whose `id` and `protocol` have already been validated. */
export function parseHttpManifest(
  id: string,
  root: Record<string, unknown>,
): HttpManifest {
  const actions = expectArray(root.actions, 'manifest.actions').map((
    action,
    index,
  ) => parseAction(action, `manifest.actions[${index}]`))
  const authentication = parseHttpAuthentication(
    root.authentication,
    'manifest.authentication',
  )
  return { protocol: 'http', id, authentication, actions }
}
