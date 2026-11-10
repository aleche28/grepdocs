package routers

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"grepdocs/api/openapi"
)

// specPath is where the spec is served; Swagger UI loads it from the same origin
const specPath = "/api/docs/openapi.yaml"

// swaggerUIPage loads Swagger UI 5 (OpenAPI 3.1 support) from jsDelivr, pinned with SRI hashes.
// Bump the version and both hashes together.
const swaggerUIPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GrepDocs API</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.34.1/swagger-ui.css"
    integrity="sha384-4c3vsE5f+trhFyHrFrLM1fFGUn531NIaC7dcqEWIJdoRQJ5CkJbSuSCwXLpaS1KF" crossorigin="anonymous">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.34.1/swagger-ui-bundle.js"
    integrity="sha384-XFYN47VzPiDY6qPtxYKg0nqUeW/upo20xf1j2SUE7gT/i35FJB4cuS/71Iegzk8Z" crossorigin="anonymous"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: "` + specPath + `",
      dom_id: "#swagger-ui",
      tryItOutEnabled: true,
    });
  </script>
</body>
</html>
`

// DocsRoutes serves the OpenAPI spec and a Swagger UI page for it. Mount it only outside
// production: requests from the page carry the browser's session cookie, so a signed-in
// developer can call every endpoint from it.
func DocsRoutes() chi.Router {
	r := chi.NewRouter()

	r.Get("/", serveSwaggerUI)
	r.Get("/openapi.yaml", serveSpec)

	return r
}

func serveSwaggerUI(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(swaggerUIPage)) // a failed write means the client is gone
}

func serveSpec(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/yaml")
	_, _ = w.Write(openapi.Spec) // a failed write means the client is gone
}
