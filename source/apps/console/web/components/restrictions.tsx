import { Badge } from '@ritaj/ui'

/** How a restricted field is shown by default, in a few words. */
function describe(presentation: unknown): string {
  if (typeof presentation === 'string') return presentation
  const spec = presentation as Record<string, unknown>
  if (spec.kind === 'partial' && spec.form) return `partial, ${spec.form}`
  if (spec.kind === 'partial') return `partial, ${spec.keep} ${spec.count}`
  if (spec.kind === 'replacement') return `replaced by ${spec.using}`
  return String(spec.kind)
}

/** Each restricted field of an answer, and how it is shown unless a policy says otherwise. */
export function Restrictions(
  { restrictions }: { restrictions: Record<string, unknown> | undefined },
) {
  const fields = Object.entries(restrictions ?? {})
  if (fields.length === 0) {
    return <span className='text-caption text-muted-foreground'>None</span>
  }
  return (
    <ul className='grid gap-1'>
      {fields.map(([field, presentation]) => (
        <li key={field} className='flex flex-wrap items-center gap-2'>
          <code className='font-mono text-caption'>{field}</code>
          <Badge color='gray' size='compact'>{describe(presentation)}</Badge>
        </li>
      ))}
    </ul>
  )
}

/** How a request is recognized as an action, in a few words: `GET /members`. */
export function matchOf(match: Record<string, unknown> | undefined): string {
  if (match === undefined) return 'Answered by the guard itself'
  const methods = [match.method].flat().join(', ')
  const paths = [match.path].flat().join(', ')
  return `${methods} ${paths}`
}
