import { assertEquals } from '@std/assert'
import { parse as parseYaml } from '@std/yaml'
import * as Distribution from '@idhn/distribution'
import { Base } from './base.ts'
import { Builds } from './builds.ts'
import { Compiler } from './compiler.ts'
import { Opa } from './opa.ts'
import { SourceTree } from './source-tree.ts'
import { VALID_TREE, writeTree } from './test-fixtures.ts'

/** The deployment's own: who may operate the console. */
const BASE_TREE: Record<string, string> = {
  'policies/operators.rego': 'package console.operators\n\nallow := true\n',
  'policies.yaml':
    'associations:\n  console.policies.publish: [console.operators]\n',
}

async function treeOf(
  files: Record<string, string>,
  version: string,
): Promise<SourceTree> {
  const dir = await Deno.makeTempDir()
  await writeTree(dir, files)
  return new SourceTree(dir, version)
}

async function based() {
  const base = Base.at((await treeOf(BASE_TREE, 'unused')).dir)
  const publication = new Distribution.Publication()
  return {
    base,
    publication,
    builds: new Builds(new Compiler(new Opa()), publication, base),
  }
}

const associationsOf = (set: Distribution.PolicySet | undefined) =>
  (parseYaml(set!.registry) as { associations: Record<string, string[]> })
    .associations

Deno.test('Base: built alone, it is what judges get before anything is published', async () => {
  const { base, builds, publication } = await based()

  const outcome = await builds.build(base.alone!)

  assertEquals(outcome.built, true)
  assertEquals(publication.current?.version, 'base')
  assertEquals(associationsOf(publication.current), {
    'console.policies.publish': ['console.operators'],
  })
})

Deno.test('Base: every tree is built with the base beneath it', async () => {
  const { builds, publication } = await based()

  const outcome = await builds.build(await treeOf(VALID_TREE, 'r1'))

  assertEquals(outcome.built, true)
  assertEquals(publication.current?.version, 'r1')
  assertEquals(associationsOf(publication.current), {
    'console.policies.publish': ['console.operators'],
    'shop.browse': ['shop.public'],
  })
})

Deno.test('Base: a tree may neither replace a base policy nor govern an action the base governs', async () => {
  const { builds, publication } = await based()

  const outcome = await builds.check(
    await treeOf({
      ...VALID_TREE,
      'policies/locked.rego': 'package console.operators\n\nallow := false\n',
      'policies.yaml':
        'associations:\n  shop.browse: [shop.public]\n  console.policies.publish: [shop.public]\n',
    }, 'r1'),
  )

  assertEquals(outcome, {
    passed: false,
    problems: [
      'console.operators is a base policy, which only the deployment can change',
      'policies.yaml: console.policies.publish is governed by the base policies, which only the deployment can change',
    ],
  })
  assertEquals(publication.current, undefined)
})
