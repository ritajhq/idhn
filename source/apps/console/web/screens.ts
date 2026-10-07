import type { IconName } from '@ritaj/ui'

/** What is guarded and who may do what, then what happened: two groups, kept apart in the sidebar. */
export type Group = 'authorization' | 'observability'

export type ScreenId = 'resources' | 'policies' | 'associations' | 'audit'

export interface Screen {
  readonly id: ScreenId
  readonly label: string
  readonly description: string
  readonly icon: IconName
  readonly group: Group
}

export const SCREENS: readonly Screen[] = [
  {
    id: 'resources',
    label: 'Resources',
    description: 'The services behind guards, imported from their manifests',
    icon: 'globe',
    group: 'authorization',
  },
  {
    id: 'policies',
    label: 'Policies',
    description: 'Author, check and publish the policies judges evaluate',
    icon: 'shield',
    group: 'authorization',
  },
  {
    id: 'associations',
    label: 'Associations',
    description: "Which policies govern each of a resource's actions",
    icon: 'link',
    group: 'authorization',
  },
  {
    id: 'audit',
    label: 'Audit',
    description: 'What guards let through or refused, and why',
    icon: 'inbox',
    group: 'observability',
  },
]

export const GROUPS: readonly {
  readonly group: Group
  readonly label: string
}[] = [
  { group: 'authorization', label: 'Authorization' },
  { group: 'observability', label: 'Observability' },
]

/** The screen a `#/…` hash names, the first otherwise. */
export function ScreenOf(hash: string): Screen {
  return SCREENS.find((screen) => hash.startsWith(`#/${screen.id}`)) ??
    SCREENS[0]
}
