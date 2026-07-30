import { assertEquals, assertThrows } from '@std/assert'
import { ConfigError, type EnvReader, loadConfig } from './config.ts'

function fakeEnv(values: Record<string, string>): EnvReader {
  return { get: (name) => values[name] }
}

const validEnv = {
  POLICY_BUNDLE_PATH: '/etc/judge/policy.wasm',
}

Deno.test('loadConfig: reads all required values', () => {
  const config = loadConfig(fakeEnv(validEnv))

  assertEquals(config.bundlePath, '/etc/judge/policy.wasm')
})

Deno.test('loadConfig: kvPath is undefined when KV_PATH is unset', () => {
  const config = loadConfig(fakeEnv(validEnv))

  assertEquals(config.kvPath, undefined)
})

Deno.test('loadConfig: reads kvPath when KV_PATH is set', () => {
  const config = loadConfig(
    fakeEnv({ ...validEnv, KV_PATH: '/var/lib/judge/policies.db' }),
  )

  assertEquals(config.kvPath, '/var/lib/judge/policies.db')
})

Deno.test('loadConfig: defaults JUDGE_PORT to 8081 when unset', () => {
  const config = loadConfig(fakeEnv(validEnv))

  assertEquals(config.port, 8081)
})

Deno.test('loadConfig: uses JUDGE_PORT when set to a valid port', () => {
  const config = loadConfig(fakeEnv({ ...validEnv, JUDGE_PORT: '9000' }))

  assertEquals(config.port, 9000)
})

Deno.test('loadConfig: throws when POLICY_BUNDLE_PATH is missing', () => {
  const { POLICY_BUNDLE_PATH: _omit, ...rest } = validEnv
  assertThrows(
    () => loadConfig(fakeEnv(rest)),
    ConfigError,
    'POLICY_BUNDLE_PATH',
  )
})

Deno.test('loadConfig: throws when JUDGE_PORT is not a valid port number', () => {
  assertThrows(
    () => loadConfig(fakeEnv({ ...validEnv, JUDGE_PORT: 'not-a-number' })),
    ConfigError,
    'JUDGE_PORT',
  )
  assertThrows(
    () => loadConfig(fakeEnv({ ...validEnv, JUDGE_PORT: '0' })),
    ConfigError,
    'JUDGE_PORT',
  )
  assertThrows(
    () => loadConfig(fakeEnv({ ...validEnv, JUDGE_PORT: '99999' })),
    ConfigError,
    'JUDGE_PORT',
  )
})
