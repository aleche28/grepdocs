package routers

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"grepdocs/api/httpx"
	"grepdocs/api/middleware"
	"grepdocs/api/providers"
	"grepdocs/api/session"
)

type ProvidersHandler struct {
	providerRegistry *providers.Registry
}

// ProvidersRoutes initializes the routes that describe the linkable providers
func ProvidersRoutes(sm *session.SessionManager, pr *providers.Registry) chi.Router {
	h := &ProvidersHandler{providerRegistry: pr}

	r := chi.NewRouter()

	// All routes require authentication
	r.Use(middleware.RequireAuth(sm))

	r.Get("/", h.listProviders)

	return r
}

// providerDTO describes a linkable provider. InstallURL is nil (JSON null) when
// the provider has no app to install, or no install URL is configured.
type providerDTO struct {
	Name        string  `json:"name"`
	DisplayName string  `json:"display_name"`
	InstallURL  *string `json:"install_url"`
}

func toProviderDTO(p providers.Provider) providerDTO {
	dto := providerDTO{Name: p.Name(), DisplayName: p.DisplayName()}
	if u := installURL(p); u != "" {
		dto.InstallURL = &u
	}
	return dto
}

// listProviders returns the providers the user can link, sorted by name. It
// reads only server configuration and never calls a provider.
func (h *ProvidersHandler) listProviders(w http.ResponseWriter, _ *http.Request) {
	list := h.providerRegistry.List()
	dtos := make([]providerDTO, len(list)) // never nil, so an empty list is [] rather than null
	for i, p := range list {
		dtos[i] = toProviderDTO(p)
	}
	httpx.WriteJSON(w, http.StatusOK, dtos)
}
