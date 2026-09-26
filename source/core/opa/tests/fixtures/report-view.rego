package report.view

# A role the identity provider cannot say, kept in `data` and keyed by the subject.
default allow := false

allow if {
	input.auth.status == "authenticated"
	"auditor" in data.roles[input.auth.subject]
}
