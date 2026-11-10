// Package openapi embeds the hand-written OpenAPI spec of the API.
package openapi

import _ "embed"

// Spec is the OpenAPI 3.1 document in openapi.yaml.
//
//go:embed openapi.yaml
var Spec []byte
