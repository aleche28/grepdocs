package models

import "time"

type CreateRepositoryRequest struct {
	Provider      string `json:"provider"`
	AccountID     int64  `json:"account_id"`
	Owner         string `json:"owner"`
	Name          string `json:"name"`
	TrackedBranch string `json:"tracked_branch"`
}

type Repository struct {
	ID             int64      `json:"id"`
	AccountID      *int64     `json:"account_id"`
	Provider       string     `json:"provider"`
	ProviderRepoID string     `json:"provider_repo_id"`
	Owner          string     `json:"owner"`
	Name           string     `json:"name"`
	FullName       string     `json:"full_name"`
	HTMLURL        string     `json:"html_url"`
	IsPrivate      bool       `json:"is_private"`
	DefaultBranch  string     `json:"default_branch"`
	TrackedBranch  string     `json:"tracked_branch"`
	SyncedCommit   *string    `json:"synced_commit"`
	SyncStatus     string     `json:"sync_status"`
	AutoSync       bool       `json:"auto_sync"`
	LastSyncAt     *time.Time `json:"last_sync_at"`
	CreatedAt      *time.Time `json:"created_at"`
	UpdatedAt      *time.Time `json:"updated_at"`
}
