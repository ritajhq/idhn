import { assertEquals } from '@std/assert'
import * as Distribution from '@idhn/distribution'
import { Builds } from './builds.ts'
import { Compiler } from './compiler.ts'
import { UploadIntake, VERSION_HEADER } from './intake.ts'
import { Opa } from './opa.ts'
import { Upload } from './sources/upload.ts'
import { tarOf, VALID_TREE } from './test-fixtures.ts'

function builder(stateDir: string) {
  const publication = new Distribution.Publication()
  const builds = new Builds(new Compiler(new Opa()), publication)
  const upload = new Upload(stateDir)
  upload.OnSources.Do((tree) => builds.build(tree))
  return { publication, upload, intake: new UploadIntake(upload, builds) }
}

function put(archive: Uint8Array<ArrayBuffer>, version: string): Request {
  return new Request('http://builder/sources', {
    method: 'PUT',
    headers: { [VERSION_HEADER]: version },
    body: archive,
  })
}

Deno.test('UploadIntake: publishes an upload that builds, answering its version', async () => {
  const { publication, upload, intake } = builder(await Deno.makeTempDir())
  await upload.start()

  const response = await intake.handle(put(await tarOf(VALID_TREE), 'commit-1'))

  assertEquals(response.status, 200)
  assertEquals(await response.json(), { version: 'commit-1' })
  assertEquals(publication.current?.version, 'commit-1')
})

Deno.test('UploadIntake: refuses an upload that does not build, keeping the published set', async () => {
  const { publication, upload, intake } = builder(await Deno.makeTempDir())
  await upload.start()
  await intake.handle(put(await tarOf(VALID_TREE), 'commit-1'))

  const response = await intake.handle(put(
    await tarOf({ ...VALID_TREE, 'policies.yaml': 'associations:\n  shop.browse: [shop.missing]\n' }),
    'commit-2',
  ))

  assertEquals(response.status, 422)
  assertEquals((await response.json()).problems.length, 1)
  assertEquals(publication.current?.version, 'commit-1')
})

Deno.test('UploadIntake: refuses what is not a tar archive', async () => {
  const { upload, intake } = builder(await Deno.makeTempDir())
  await upload.start()

  const response = await intake.handle(put(new TextEncoder().encode('not a tar'), 'x'))

  assertEquals(response.status, 400)
})

Deno.test('Upload.start: publishes the last kept upload again after a restart', async () => {
  const stateDir = await Deno.makeTempDir()
  const before = builder(stateDir)
  await before.upload.start()
  await before.intake.handle(put(await tarOf(VALID_TREE), 'commit-1'))

  const after = builder(stateDir)
  const built = new Promise<string>((resolve) => after.publication.OnPublished.DoOnce((set) => resolve(set.version)))
  await after.upload.start()

  assertEquals(await built, 'commit-1')
})

function check(archive: Uint8Array<ArrayBuffer>, version: string): Request {
  return new Request('http://builder/checks', {
    method: 'POST',
    headers: { [VERSION_HEADER]: version },
    body: archive,
  })
}

Deno.test('UploadIntake.check: says whether sources would build, publishing nothing either way', async () => {
  const { publication, upload, intake } = builder(await Deno.makeTempDir())
  await upload.start()

  const passing = await intake.check(check(await tarOf(VALID_TREE), 'draft-1'))
  assertEquals(passing.status, 200)
  assertEquals(await passing.json(), { version: 'draft-1', problems: [] })

  const failing = await intake.check(check(
    await tarOf({ ...VALID_TREE, 'policies.yaml': 'associations:\n  shop.browse: [shop.missing]\n' }),
    'draft-2',
  ))
  assertEquals(failing.status, 422)
  assertEquals((await failing.json()).problems.length, 1)

  assertEquals(publication.current, undefined)
})
