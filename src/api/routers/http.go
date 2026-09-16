package routers

import (
	"net/http"
	"time"
)

// shared client for outbound calls
var httpClient = &http.Client{Timeout: 10 * time.Second}
