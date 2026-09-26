package invoice.approve.base

default allow := false

# Any authenticated subject may approve invoices under $1000.
allow if {
	input.subject != ""
	input.amount < 1000
}
