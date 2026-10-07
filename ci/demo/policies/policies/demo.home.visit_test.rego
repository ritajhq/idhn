package demo.home.visit_test

import data.demo.home.visit

test_vips_are_let_in if {
	visit.allow with input as {"vip": "true"}
}

test_everyone_else_is_turned_away if {
	not visit.allow with input as {}
}
