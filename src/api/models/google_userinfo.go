package models

type GoogleUserInfo struct {
	Id        string `json:"id"`
	Email     string `json:"email"`
	FullName  string `json:"name"`
	FirstName string `json:"given_name"`
	LastName  string `json:"family_name"`
	Picture   string `json:"picture"`
}
