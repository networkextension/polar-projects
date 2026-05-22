package projects

// helpers.go — utility funcs copied from dock so projects-svc has no
// compile-time dependency on the dock package.

import (
	"crypto/rand"
	"encoding/base64"
	"strconv"
)

// generateResourceID — dock's store.go::generateResourceID equivalent.
// Returns a URL-safe base64 random ID (24 bytes ≈ 32 chars after enc).
func generateResourceID() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// itoa — short alias for strconv.Itoa, used inside SQL builders to
// shorten `$` placeholder concatenation.
func itoa(i int) string { return strconv.Itoa(i) }
