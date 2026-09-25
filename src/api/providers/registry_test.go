package providers

import "testing"

func TestRegistryLookup(t *testing.T) {
	r := NewRegistry(NewGitHub(GitHubOptions{}))

	if _, ok := r.Lookup(GitHub); !ok {
		t.Errorf("Lookup(%q) not found, want found", GitHub)
	}
	if _, ok := r.Lookup("gitlab"); ok {
		t.Errorf("Lookup(%q) found, want not found", "gitlab")
	}
}
