package providers

import (
	"maps"
	"slices"
	"strings"
)

type Registry struct {
	providers map[string]Provider
}

// NewRegistry registers ps. It panics if two providers share a name: the
// registry is built once at startup, so a duplicate is a programming error.
func NewRegistry(ps ...Provider) *Registry {
	r := &Registry{providers: make(map[string]Provider)}
	for _, p := range ps {
		if _, dup := r.providers[p.Name()]; dup {
			panic("providers: duplicate provider " + p.Name())
		}
		r.providers[p.Name()] = p
	}
	return r
}

func (r *Registry) Lookup(name string) (Provider, bool) {
	p, ok := r.providers[name]
	return p, ok
}

// List returns the registered providers sorted by name.
func (r *Registry) List() []Provider {
	return slices.SortedFunc(maps.Values(r.providers), func(a, b Provider) int {
		return strings.Compare(a.Name(), b.Name())
	})
}
