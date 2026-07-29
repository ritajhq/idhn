package invoice.approve

default allow := false

allow if {
	input.subject == "alice"
}
