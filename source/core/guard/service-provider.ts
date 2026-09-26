import type { Rejection } from './rejection.ts'

/**
 * Carries out a `Guard`'s verdict on one request: forwards it to the
 * protected service, or rejects it for the given reason. Implementations are
 * constructed per-request with whatever raw data they need (the request, a
 * response handle, etc.) closed over. Deliberately knows nothing of
 * `Decision` — allow/deny semantics stay inside `Guard`'s own orchestration.
 */
export interface ServiceProvider {
  forward(): Promise<void>
  reject(rejection: Rejection): Promise<void>
}
