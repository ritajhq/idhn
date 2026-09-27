# @idhn/log

Structured logging as JSON Lines on stdout. Import as a namespace:

```ts
import * as Log from '@idhn/log'

const log = new Log.JsonLines()
log.write('judge.decision', record)
```

The process only ever writes to stdout. Collecting, shipping and storing the
lines is left to a log shipper, so logging never adds network latency.
