package invoice.directory

default allow := false

allow if {
	input.agent_directory.active == true
}
