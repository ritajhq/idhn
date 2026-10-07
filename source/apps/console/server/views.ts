import type * as Authoring from '@idhn/authoring'
import type * as Contract from '@idhn/contract'
import type * as Resources from '@idhn/resources'

/** A resource as the console shows it. */
export function resourceView(
  resource: Resources.Resource,
): Contract.Resources.ResourceView {
  const document = resource.toDocument()
  const declared = (document.manifest.actions ?? []) as {
    name: string
    match?: Record<string, unknown>
  }[]
  const matches = new Map(
    declared.map((action) => [`${resource.id}.${action.name}`, action.match]),
  )
  return {
    id: resource.id,
    origin: document.origin,
    importedAt: document.importedAt,
    protocol: resource.manifest.protocol,
    authentication: resource.manifest.authentication.scheme,
    actions: resource.actions.map((action) => ({
      name: action.name,
      builtIn: action.builtIn,
      ...(matches.get(action.name) ? { match: matches.get(action.name) } : {}),
      ...(action.restrictions
        ? { restrictions: action.restrictions.toJSON() }
        : {}),
    })),
    manifest: document.manifest,
  }
}

/** The draft as the console shows it. */
export function draftView(draft: Authoring.Draft): Contract.Policies.DraftView {
  const document = draft.toDocument()
  return {
    revision: draft.revision,
    policies: draft.all.map((policy) => ({
      name: policy.name.toString(),
      source: policy.source,
      ...(policy.tests === undefined ? {} : { tests: policy.tests }),
      governs: draft.governedBy(policy.name.toString()),
    })),
    associations: Object.fromEntries(
      Object.entries(document.associations).map((
        [action, policies],
      ) => [action, [...policies]]),
    ),
  }
}

/** A revision as the console shows it; its sources only when asked for. */
export function revisionView(
  revision: Authoring.Revision,
  withFiles = false,
): Contract.Policies.RevisionView {
  return {
    number: revision.number,
    version: revision.version,
    publishedAt: revision.publishedAt.toISOString(),
    publishedBy: revision.publishedBy,
    draftRevision: revision.draftRevision,
    ...(withFiles ? { files: { ...revision.files } } : {}),
  }
}
