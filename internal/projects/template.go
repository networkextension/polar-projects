package projects

// template.go — thin wrapper around text/template so the SDK fallback
// rendering in stubs.go stays tidy.

import "text/template"

func newTemplate(tpl string) (*template.Template, error) {
	return template.New("projects").Parse(tpl)
}
