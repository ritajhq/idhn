package place.manage

# A relationship looked up live by enrichment (`/managers/{auth.subject}`), never a hardcoded username list.
default allow := false

allow if {
	input.auth.status == "authenticated"
	input.placeId in input.managed_places.places
}
