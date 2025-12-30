# How to setup Google OAuth2.0

Adapted from <https://dev.to/siddheshk02/oauth-20-implementation-in-golang-3mj1>.

## Get client id and client secret

First of all you need a client id and client secret of the client application.

1. Open <https://console.cloud.google.com/apis> and go to 'APIs & Services' and then 'Credentials'
2. Press 'Create Credentials' and then 'Create OAuth Client ID'
3. In the creation form, select 'Web application' as application type, give a meaningful name to the app (e.g. GrepDocs API) and add `http://localhost:3000/api/auth/google/callback` to the 'Authorized redirect URIs' section.
This URI should be adapted in production to match the actual application hostname and your specific callback endpoint.
4. Click on 'Create' and copy the 'Client ID' and 'Client secret' fields. Note that once you close the dialog you are going to lose the secret, so make sure you copy it before closing the dialog.
5. Paste client id and secret into your `.env` file.

## Setup Go server

First install the OAuth2 package and the godotenv package to help with loading variables from `.env` file:

```bash
go get golang.org/x/oauth2
go get github.com/joho/godotenv
```

In your code, you should load the values of the variables from the `.env` file
(or directly from the environment in production) and store them in some
configuration variable.
You can use this as an example (I also put the redirect url in the env),
with Chi (<https://go-chi.io/>) for the api routing.

```go
package main

import (
    "log"
    "net/http"
    "os"

    "github.com/go-chi/chi/v5"
    "github.com/go-chi/chi/v5/middleware"
    "github.com/joho/godotenv"
    "golang.org/x/oauth2"
    "golang.org/x/oauth2/google"
)

type GoogleUserInfo struct {
    Id        string `json:"id"`
    Email     string `json:"email"`
    FullName  string `json:"name"`
    FirstName string `json:"given_name"`
    LastName  string `json:"family_name"`
    Picture   string `json:"picture"`
}

type Config struct {
    GoogleLoginConfig oauth2.Config
}

var AppConfig Config

func main() {
    err := godotenv.Load()
    if err != nil {
        log.Fatal("Error loading .env file")
    }

    clientId := os.Getenv("GOOGLE_CLIENT_ID")
    clientSecret := os.Getenv("GOOGLE_CLIENT_SECRET")
    redirectUrl := os.Getenv("GOOGLE_REDIRECT_URL")

    AppConfig.GoogleLoginConfig = oauth2.Config{
        ClientID:     clientId,
        ClientSecret: clientSecret,
        RedirectURL:  redirectUrl,
        Scopes: []string{
            "https://www.googleapis.com/auth/userinfo.email",
            "https://www.googleapis.com/auth/userinfo.profile",
            "openid",
        },
        Endpoint: google.Endpoint,
    }

    r := chi.NewRouter()
    r.Use(middleware.Logger)

    r.Get("/api/auth/google/login", googleLogin)
    r.Get("/api/auth/google/callback", googleCallback)

    http.ListenAndServe(":3000", r)
}


func googleLogin(w http.ResponseWriter, r *http.Request) {
    url := AppConfig.GoogleLoginConfig.AuthCodeURL("randomstate")
    http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

func googleCallback(w http.ResponseWriter, r *http.Request) {
    // Extract and compare state: should be the same as the sent one
    state := r.URL.Query().Get("state")
    if state != "randomstate" {
        http.Error(w, "Received state does not match the sent state value", http.StatusBadRequest)
        return
    }

    // Extract the authorization code from the URL
    code := r.URL.Query().Get("code")
    if code == "" {
        http.Error(w, "Code not found in URL", http.StatusBadRequest)
        return
    }

    // Exchange the code for an access token
    token, err := googleOauthConfig.Exchange(context.Background(), code)
    if err != nil {
        http.Error(w, "Failed to exchange token: "+err.Error(), http.StatusInternalServerError)
        return
    }

    resp, err := http.Get("https://www.googleapis.com/oauth2/v2/userinfo?access_token=" + token.AccessToken)
    if err != nil {
        http.Error(w, "Failed to fetch user data: "+err.Error(), http.StatusInternalServerError)
        return
    }

    defer resp.Body.Close()

    // Read the response body
    body, err := io.ReadAll(resp.Body)
    if err != nil {
        http.Error(w, "Failed to read response body: "+err.Error(), http.StatusInternalServerError)
        return
    }

    var userInfo GoogleUserInfo
    err = json.Unmarshal(body, &userInfo)
    if err != nil {
        http.Error(w, "Failed to parse user data: "+err.Error(), http.StatusInternalServerError)
        return
    }

    // Successfully retrieved user info
    fmt.Fprintf(w, "Login successful! Hello, %s", userInfo.Email)
}
```

## Test login

Run the server with

```bash
go run main.go
```

Then in your browser go to `http://localhost:3000/api/auth/google/login`.
You should be redirected to the google login interface.
Once you finish the login flow, you should automatically be redirected to
`http://localhost:3000/api/auth/google/callback` that shows you the
success message with your google account email.
