package models

import "time"

type Document struct {
	ID       int64      `json:"id"`
	SHA      string     `json:"sha"`
	Path     string     `json:"path"`
	SyncedAt *time.Time `json:"synced_at"`
	RepoId   int64      `json:"repo_id"`
}
