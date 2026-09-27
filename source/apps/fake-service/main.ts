/**
 * A tiny stand-in "protected service" for manually exercising guard-standalone:
 * shows what it actually received (method, path, headers, body), so a
 * request forwarded through the proxy is visually distinguishable from one
 * hitting this service directly.
 */

const port = Number(Deno.env.get('PORT') ?? '9100')

Deno.serve({ port }, async (request) => {
  const url = new URL(request.url)
  const body = await request.text()
  const headers = [...request.headers.entries()]
    .map(([name, value]) =>
      `<tr><td>${escape(name)}</td><td>${escape(value)}</td></tr>`
    )
    .join('\n')

  const html = `<!doctype html>
<html>
<head><title>fake-service</title></head>
<body style="font-family: sans-serif; max-width: 40rem; margin: 2rem auto;">
  <h1>You reached fake-service</h1>
  <p>If you got here through guard-standalone, the request was allowed.</p>
  <table border="1" cellpadding="4" style="border-collapse: collapse;">
    <tr><td><strong>method</strong></td><td>${escape(request.method)}</td></tr>
    <tr><td><strong>path</strong></td><td>${
    escape(url.pathname + url.search)
  }</td></tr>
    ${headers}
  </table>
  ${body.length > 0 ? `<h2>body</h2><pre>${escape(body)}</pre>` : ''}
</body>
</html>`

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
})

function escape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
