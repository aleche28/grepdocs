package providers

import (
	"slices"
	"testing"
)

// namedProvider is a registrable provider with a chosen name; the embedded
// interface is nil, so calling any other Provider method panics
type namedProvider struct {
	Provider
	name string
}

func (p namedProvider) Name() string { return p.name }

func TestRegistryLookup(t *testing.T) {
	r := NewRegistry(NewGitHub(GitHubOptions{}))

	if _, ok := r.Lookup(GitHub); !ok {
		t.Errorf("Lookup(%q) not found, want found", GitHub)
	}
	if _, ok := r.Lookup("gitlab"); ok {
		t.Errorf("Lookup(%q) found, want not found", "gitlab")
	}
}

func TestNewRegistryPanicsOnDuplicateName(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Error("NewRegistry with a duplicate name did not panic")
		}
	}()
	NewRegistry(namedProvider{name: "a"}, namedProvider{name: "b"}, namedProvider{name: "a"})
}

func TestRegistryList(t *testing.T) {
	names := func(ps []Provider) []string {
		out := make([]string, len(ps))
		for i, p := range ps {
			out[i] = p.Name()
		}
		return out
	}

	t.Run("sorted by name", func(t *testing.T) {
		// several runs, since an unsorted map order would only fail sometimes
		for range 20 {
			r := NewRegistry(
				namedProvider{name: "zeta"},
				namedProvider{name: "alpha"},
				namedProvider{name: "mid"},
			)
			want := []string{"alpha", "mid", "zeta"}
			if got := names(r.List()); !slices.Equal(got, want) {
				t.Fatalf("List() = %v, want %v", got, want)
			}
		}
	})

	t.Run("empty registry", func(t *testing.T) {
		if got := NewRegistry().List(); len(got) != 0 {
			t.Errorf("List() = %v, want empty", names(got))
		}
	})

	t.Run("returns a copy", func(t *testing.T) {
		r := NewRegistry(namedProvider{name: "a"}, namedProvider{name: "b"})
		got := r.List()
		got[0] = namedProvider{name: "changed"}
		if want := []string{"a", "b"}; !slices.Equal(names(r.List()), want) {
			t.Errorf("List() after modifying a copy = %v, want %v", names(r.List()), want)
		}
	})
}
