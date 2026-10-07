import { useState } from 'react'
import * as Contract from '@idhn/contract'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  InputField,
  InputGroup,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useIcon,
} from '@ritaj/ui'
import { Describe } from '../console.ts'
import { useConsole } from '../console-provider.tsx'
import { Notice } from '../components/notice.tsx'
import { Panel } from '../components/panel.tsx'
import { matchOf, Restrictions } from '../components/restrictions.tsx'
import { useCall } from '../use-call.ts'

/** The guarded services: imported from their guards, each with the actions its manifest declares. */
export function Resources({ refresh }: { refresh: number }) {
  const console = useConsole()
  const resources = useCall(
    () => console.Send(new Contract.Resources.List()),
    [refresh],
  )
  const [origin, setOrigin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [message, setMessage] = useState<string | undefined>()
  const DownloadIcon = useIcon('arrow-down')
  const ReimportIcon = useIcon('rotate-ccw')

  async function importFrom(from: string) {
    setBusy(true)
    setError(undefined)
    setMessage(undefined)
    try {
      const resource = await console.Send(new Contract.Resources.Import(from))
      setMessage(
        `Imported ${resource.id}: ${resource.actions.length} actions`,
      )
      setOrigin('')
      resources.reload()
    } catch (e) {
      setError(Describe(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setError(undefined)
    try {
      await console.Send(new Contract.Resources.Remove(id))
      setMessage(`Removed ${id}; its associations stay with the policies`)
      resources.reload()
    } catch (e) {
      setError(Describe(e))
    }
  }

  const list = resources.value ?? []

  return (
    <>
      <Panel
        title='Import a resource'
        description="The guard's address: it hands over its manifest if its policies let you read it"
      >
        <form
          className='flex flex-wrap items-end gap-3'
          onSubmit={(event) => {
            event.preventDefault()
            if (origin.trim()) importFrom(origin.trim())
          }}
        >
          <InputGroup className='min-w-0 flex-1'>
            <InputField
              index={0}
              label='Guard URL'
              placeholder='https://shop.example.com'
              value={origin}
              onChange={setOrigin}
            />
          </InputGroup>
          <Button
            type='submit'
            leadingIcon={DownloadIcon}
            loading={busy}
            disabled={busy || !origin.trim()}
          >
            {busy ? 'Importing…' : 'Import'}
          </Button>
        </form>
        {error && <Notice tone='error'>{error}</Notice>}
        {message && <Notice tone='success'>{message}</Notice>}
      </Panel>

      <Panel
        title='Resources'
        description='As last imported: re-import one after its manifest changes'
      >
        {resources.error && <Notice tone='error'>{resources.error}</Notice>}
        {list.length === 0 && !resources.loading && (
          <p className='text-body text-muted-foreground'>
            Nothing imported yet
          </p>
        )}
        {list.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Resource</TableHead>
                <TableHead>Guard</TableHead>
                <TableHead>Authentication</TableHead>
                <TableHead>Imported</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((resource, i) => (
                <TableRow key={resource.id} index={i}>
                  <TableCell className='font-medium'>{resource.id}</TableCell>
                  <TableCell className='font-mono text-caption'>
                    {resource.origin}
                  </TableCell>
                  <TableCell>
                    <Badge color='gray'>{resource.authentication}</Badge>
                  </TableCell>
                  <TableCell className='whitespace-nowrap'>
                    {new Date(resource.importedAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <div className='flex justify-end gap-2'>
                      <Button
                        size='compact'
                        variant='secondary'
                        leadingIcon={ReimportIcon}
                        onClick={() => importFrom(resource.origin)}
                      >
                        Re-import
                      </Button>
                      <Button
                        size='compact'
                        variant='ghost'
                        onClick={() => remove(resource.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      {list.map((resource) => (
        <Panel
          key={resource.id}
          title={`${resource.id}'s actions`}
          description='What each request is recognized as, and what its answer restricts'
        >
          <Accordion type='multiple' className='w-full'>
            {resource.actions.map((action, index) => (
              <AccordionItem
                key={action.name}
                value={action.name}
                index={index}
              >
                <AccordionTrigger>
                  <span className='flex flex-wrap items-center gap-2'>
                    <code className='font-mono'>{action.name}</code>
                    {action.builtIn && (
                      <Badge color='blue' size='compact'>built in</Badge>
                    )}
                    {action.restrictions && (
                      <Badge color='amber' size='compact'>restricts</Badge>
                    )}
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <dl className='grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-body'>
                    <dt className='text-muted-foreground'>Matches</dt>
                    <dd className='font-mono text-caption'>
                      {matchOf(action.match)}
                    </dd>
                    <dt className='text-muted-foreground'>Restricted fields</dt>
                    <dd>
                      <Restrictions restrictions={action.restrictions} />
                    </dd>
                  </dl>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Panel>
      ))}
    </>
  )
}
