/** Runs `run` against a throwaway auth server answering with `handler`, given its session endpoint's URL. */
export async function withAuthServer(
  handler: (request: Request) => Response | Promise<Response>,
  run: (sessionUrl: string) => Promise<void>,
): Promise<void> {
  const controller = new AbortController()
  const server = Deno.serve(
    { port: 0, signal: controller.signal, onListen: () => {} },
    handler,
  )
  const addr = server.addr as Deno.NetAddr
  try {
    await run(`http://localhost:${addr.port}/api/auth/get-session`)
  } finally {
    controller.abort()
    await server.finished
  }
}

/** What BetterAuth's session endpoint answers for a valid session. */
export const aliceSession = {
  session: { id: 's-1', userId: 'u-1', expiresAt: '2099-01-01T00:00:00Z' },
  user: {
    id: 'u-1',
    username: 'alice',
    email: 'alice@example.test',
    name: 'Alice',
    emailVerified: true,
    image: null,
  },
}
