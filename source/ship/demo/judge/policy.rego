package demo.home.visit

default allow := false

# Only requests carrying ?vip=true are let through, so you can flip between
# allow/deny in a browser just by editing the URL's query string.
allow if {
	input.vip == "true"
}
