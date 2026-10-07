import { useEffect, useState } from 'react'
import * as Contract from '@idhn/contract'
import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  useIcon,
} from '@ritaj/ui'
import { useConsole } from '../console-provider.tsx'
import type { DraftState } from '../draft.ts'
import { Notice } from '../components/notice.tsx'
import { Panel } from '../components/panel.tsx'
import { matchOf } from '../components/restrictions.tsx'
import { useCall } from '../use-call.ts'

/** For one resource, which policies govern each of its actions: changed in the draft, served once published. */
export function Associations(
  { refresh, state }: { refresh: number; state: DraftState },
) {
  const console = useConsole()
  const resources = useCall(
    () => console.Send(new Contract.Resources.List()),
    [refresh],
  )
  const [chosen, setChosen] = useState<string | undefined>()
  const list = resources.value ?? []

  useEffect(() => {
    if (chosen === undefined && list[0]) setChosen(list[0].id)
  }, [resources.value])

  const resource = list.find((r) => r.id === chosen)
  const { draft, error, change } = state

  // Associations naming this resource's actions that its manifest no longer declares.
  const declared = new Set(resource?.actions.map((action) => action.name))
  const orphaned = Object.keys(draft?.associations ?? {}).filter((action) =>
    resource !== undefined && action.startsWith(`${resource.id}.`) &&
    !declared.has(action)
  )

  return (
    <Panel
      title='Associations'
      description='An action no policy governs is denied to everyone'
      action={list.length > 0 && (
        <Select value={chosen ?? ''} onValueChange={setChosen}>
          <SelectTrigger aria-label='Resource' className='w-56' />
          <SelectContent>
            {list.map((r, i) => (
              <SelectItem key={r.id} index={i} value={r.id}>{r.id}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    >
      {resources.error && <Notice tone='error'>{resources.error}</Notice>}
      {error && <Notice tone='error'>{error}</Notice>}
      {list.length === 0 && !resources.loading && (
        <p className='text-body text-muted-foreground'>
          Import a resource first: its actions are listed here
        </p>
      )}
      {resource && draft && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Action</TableHead>
              <TableHead>Governed by</TableHead>
              <TableHead className='w-56'>Add a policy</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {resource.actions.map((action, i) => (
              <ActionRow
                key={action.name}
                index={i}
                action={action}
                draft={draft}
                change={change}
              />
            ))}
          </TableBody>
        </Table>
      )}
      {orphaned.length > 0 && (
        <Notice
          tone='warning'
          details={orphaned.join(', ')}
        >
          Associations for actions {resource?.id}'s manifest no longer declares
        </Notice>
      )}
    </Panel>
  )
}

function ActionRow(
  { action, index, draft, change }: {
    action: Contract.Resources.ActionView
    index: number
    draft: Contract.Policies.DraftView
    change: DraftState['change']
  },
) {
  const XIcon = useIcon('x')
  const governing = draft.associations[action.name] ?? []
  const available = draft.policies.filter((p) => !governing.includes(p.name))

  return (
    <TableRow index={index}>
      <TableCell>
        <div className='grid gap-0.5'>
          <span className='flex flex-wrap items-center gap-2'>
            <code className='font-mono'>{action.name}</code>
            {action.builtIn && (
              <Badge color='blue' size='compact'>built in</Badge>
            )}
          </span>
          <span className='font-mono text-caption text-muted-foreground'>
            {matchOf(action.match)}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <div className='flex flex-wrap items-center gap-1.5'>
          {governing.length === 0 && (
            <Badge variant='dot' color='red'>denied to everyone</Badge>
          )}
          {governing.map((policy) => (
            <span
              key={policy}
              className='inline-flex items-center gap-1 rounded-md bg-surface-1 py-0.5 pl-2 pr-0.5 shadow-surface-1'
            >
              <code className='font-mono text-caption'>{policy}</code>
              <Tooltip content={`Stop ${policy} governing this`}>
                <Button
                  size='icon-compact'
                  variant='ghost'
                  aria-label={`Dissociate ${policy}`}
                  onClick={() =>
                    change(
                      new Contract.Policies.Dissociate(
                        draft.revision,
                        action.name,
                        policy,
                      ),
                    )}
                >
                  <XIcon />
                </Button>
              </Tooltip>
            </span>
          ))}
        </div>
      </TableCell>
      <TableCell>
        {available.length > 0 && (
          <Select
            value=''
            onValueChange={(policy) =>
              policy &&
              change(
                new Contract.Policies.Associate(
                  draft.revision,
                  action.name,
                  policy,
                ),
              )}
          >
            <SelectTrigger
              aria-label={`Add a policy to ${action.name}`}
              placeholder='Policy…'
              className='w-full'
            />
            <SelectContent>
              {available.map((p, i) => (
                <SelectItem key={p.name} index={i} value={p.name}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </TableCell>
    </TableRow>
  )
}
