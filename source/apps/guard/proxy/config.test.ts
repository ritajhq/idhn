import { assertEquals, assertThrows } from '@std/assert'
import { ConfigError, type EnvReader, loadConfig } from './config.ts'

function fakeEnv(values: Record<string, string>): EnvReader {
  return { get: (name) => values[name] }
}

const validEnv = {
  SERVICE_MANIFEST_PATH: '/etc/guard/manifest.yaml',
  POLICY_BUNDLE_PATH: '/etc/guard/policy.wasm',
  UPSTREAM_URL: 'http://upstream.internal:8000',
}

Deno.test('loadConfig: reads all required values', () => {
  const config = loadConfig(fakeEnv(validEnv))

  assertEquals(config.manifestPath, '/etc/guard/manifest.yaml')
  assertEquals(config.bundlePath, '/etc/guard/policy.wasm')
  assertEquals(config.upstreamUrl, new URL('http://upstream.internal:8000'))
})

Deno.test('loadConfig: defaults PROXY_PORT to 8080 when unset', () => {
  const config = loadConfig(fakeEnv(validEnv))

  assertEquals(config.port, 8080)
})

Deno.test('loadConfig: uses PROXY_PORT when set to a valid port', () => {
  const config = loadConfig(fakeEnv({ ...validEnv, PROXY_PORT: '3000' }))

  assertEquals(config.port, 3000)
})

Deno.test('loadConfig: throws when SERVICE_MANIFEST_PATH is missing', () => {
  const { SERVICE_MANIFEST_PATH: _omit, ...rest } = validEnv
  assertThrows(
    () => loadConfig(fakeEnv(rest)),
    ConfigError,
    'SERVICE_MANIFEST_PATH',
  )
})

Deno.test('loadConfig: throws when POLICY_BUNDLE_PATH is missing', () => {
  const { POLICY_BUNDLE_PATH: _omit, ...rest } = validEnv
  assertThrows(
    () => loadConfig(fakeEnv(rest)),
    ConfigError,
    'POLICY_BUNDLE_PATH',
  )
})

Deno.test('loadConfig: throws when UPSTREAM_URL is missing', () => {
  const { UPSTREAM_URL: _omit, ...rest } = validEnv
  assertThrows(() => loadConfig(fakeEnv(rest)), ConfigError, 'UPSTREAM_URL')
})

Deno.test('loadConfig: throws when UPSTREAM_URL is not a valid URL', () => {
  assertThrows(
    () => loadConfig(fakeEnv({ ...validEnv, UPSTREAM_URL: 'not a url' })),
    ConfigError,
    'UPSTREAM_URL',
  )
})

Deno.test('loadConfig: throws when PROXY_PORT is not a valid port number', () => {
  assertThrows(
    () => loadConfig(fakeEnv({ ...validEnv, PROXY_PORT: 'not-a-number' })),
    ConfigError,
    'PROXY_PORT',
  )
  assertThrows(
    () => loadConfig(fakeEnv({ ...validEnv, PROXY_PORT: '0' })),
    ConfigError,
    'PROXY_PORT',
  )
  assertThrows(
    () => loadConfig(fakeEnv({ ...validEnv, PROXY_PORT: '99999' })),
    ConfigError,
    'PROXY_PORT',
  )
})
