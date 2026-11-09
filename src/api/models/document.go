package models

import "time"

type Document struct {
	ID             int64     `json:"id"`
	SHA            string    `json:"sha"`
	Path           string    `json:"path"`
	SyncedAt       time.Time `json:"synced_at"`
	RepositoryID   int64     `json:"repository_id"`
	Repository     string    `json:"repository"`
	Provider       string    `json:"provider"`
	Branch         string    `json:"branch"`
	UpstreamCommit *string   `json:"upstream_commit"`
}
