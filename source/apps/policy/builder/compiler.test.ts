import { assert, assertEquals, assertRejects } from '@std/assert'
import { CompileError, Compiler } from './compiler.ts'
import { Opa } from './opa.ts'
import { SourceTree } from './source-tree.ts'
import { VALID_TREE, writeTree } from './test-fixtures.ts'
import * as Access from '@idhn/access'
import * as OPA from '@idhn/opa'
import * as Policy from '@idhn/policy'

async function treeOf(files: Record<string, string>): Promise<SourceTree> {
  const dir = await Deno.makeTempDir()
  await writeTree(dir, files)
  return new SourceTree(dir, 'v1')
}

const compiler = new Compiler(new Opa())

Deno.test('Compiler.compile: turns valid sources into a policy set with a WASM bundle', async () => {
  const set = await compiler.compile(await treeOf(VALID_TREE))

  assertEquals(set.version, 'v1')
  assertEquals([...set.bundle.slice(0, 4)], [0, 0x61, 0x73, 0x6d]) // "\0asm"
  assertEquals(set.registry, VALID_TREE['policies.yaml'])
  assertEquals(set.enrichment, VALID_TREE['enrichment.yaml'])
  assertEquals(set.data, undefined)
})

Deno.test('Compiler.compile: refuses a registry naming a policy no file declares', async () => {
  const tree = await treeOf({
    ...VALID_TREE,
    'policies.yaml': 'associations:\n  shop.browse: [shop.missing]\n',
  })

  const error = await assertRejects(() => compiler.compile(tree), CompileError)

  assertEquals(error.problems, [
    'policies.yaml: shop.browse is governed by shop.missing, which no policy file declares',
  ])
})

Deno.test("Compiler.compile: refuses Rego that does not compile, with opa's report", async () => {
  const tree = await treeOf({
    ...VALID_TREE,
    'policies/public.rego': 'package shop.public\n\nallow if {\n',
  })

  const error = await assertRejects(() => compiler.compile(tree), CompileError)

  assert(error.problems[0].startsWith('opa check failed'), error.problems[0])
})

Deno.test('Compiler.compile: refuses policies whose tests fail', async () => {
  const tree = await treeOf({
    ...VALID_TREE,
    'policies/public.rego': 'package shop.public\n\nallow := false\n',
  })

  const error = await assertRejects(() => compiler.compile(tree), CompileError)

  assert(error.problems[0].startsWith('opa test failed'), error.problems[0])
})

Deno.test('Compiler.compile: refuses malformed enrichment and data, reporting both', async () => {
  const tree = await treeOf({
    ...VALID_TREE,
    'enrichment.yaml': 'lookups:\n  - as: x\n',
    'data.json': '{ not json',
  })

  const error = await assertRejects(() => compiler.compile(tree), CompileError)

  assertEquals(error.problems.length, 2)
})

Deno.test('Compiler.compile: reports a registry problem and a Rego error in the same refusal', async () => {
  const tree = await treeOf({
    ...VALID_TREE,
    'policies.yaml': 'associations:\n  shop.browse: [shop.missing]\n',
    'policies/broken.rego': 'package shop.broken\n\nallow if {\n',
  })

  const error = await assertRejects(() => compiler.compile(tree), CompileError)

  assertEquals(error.problems.length, 2)
  assert(error.problems[1].startsWith('opa check failed'), error.problems[1])
})

Deno.test("Compiler.compile: compiles a package's `show` rule too, so judges can say how the answer may be shown", async () => {
  const set = await compiler.compile(
    await treeOf({
      ...VALID_TREE,
      'policies/directory.rego':
        'package shop.directory\n\nallow := true\n\nshow["/members/*/email"] := {"kind": "partial", "form": "email"}\n',
      'policies.yaml':
        'associations:\n  shop.browse: [shop.public]\n  shop.list: [shop.directory]\n',
    }),
  )

  const engine = await OPA.PolicyEngine.load(set.bundle)
  const directory = await engine.evaluate(
    new Policy.Identifier('shop.directory'),
    new Access.Context({}),
  )
  assertEquals(directory.disclosure.toJSON(), {
    '/members/*/email': { kind: 'partial', form: 'email' },
  })
  // A package without one still compiles, and says nothing.
  const open = await engine.evaluate(
    new Policy.Identifier('shop.public'),
    new Access.Context({}),
  )
  assertEquals(open.disclosure.isEmpty, true)
})
