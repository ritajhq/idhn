package member.directory

# Any signed-in member may list the directory, but sees only what `show` lets
# through: whose domain each email is on, and full names only for admins. The
# manifest covers both by default, so a caller this says nothing about sees
# neither.
default allow := false

allow if input.auth.status == "authenticated"

show["/members/*/email"] := {"kind": "partial", "form": "email"}

show["/members/*/name"] := "visible" if input.auth.claims.role == "admin"

show["/members/*/name"] := {"kind": "replacement", "using": "initials"} if input.auth.claims.role != "admin"
