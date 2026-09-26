package profile.read

# Authentication required: only a verified, authenticated user may read a profile.
default allow := false

allow if {
	input.auth.status == "authenticated"
	input.auth.claims.emailVerified == true
}
