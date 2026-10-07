package resource.steward

# Only admins may look after a resource: read its guard's manifest, say, to
# import it into the console.
default allow := false

allow if input.auth.claims.role == "admin"
