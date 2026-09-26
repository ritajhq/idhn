package invoice.allowlisted

default allow := false

allow if {
	input.subject in data.approvers
}
