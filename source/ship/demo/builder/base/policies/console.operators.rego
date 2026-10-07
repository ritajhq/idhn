package console.operators

# No one signs in to the demo, so anyone may use the console. Elsewhere, the
# console's guard authenticates by session cookie, and this policy says who
# among the signed-in may operate it.
allow := true
