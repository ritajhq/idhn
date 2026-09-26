package invoice.approve.fraud_override

# Denies approval outright when the subject is flagged, regardless of what
# the base policy says — this is what DenyOverridesStrategy must honor.
deny if {
	input.flagged == true
}

allow := false if {
	deny
}
