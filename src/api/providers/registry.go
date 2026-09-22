package providers

type Registry struct {
	providers map[string]Provider
}

func NewRegistry(providers ...Provider) *Registry {
	r := &Registry{}
	r.providers = make(map[string]Provider)
	for _, p := range providers {
		r.providers[p.Name()] = p
	}
	return r
}

func (r *Registry) Lookup(name string) (Provider, bool) {
	p, ok := r.providers[name]
	return p, ok
}
