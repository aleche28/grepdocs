package reposync

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"grepdocs/api/credentials"
	"grepdocs/api/dal"
	"grepdocs/api/providers"
	"log"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

var errProviderNotSupported = errors.New("provider not supported")

// Stable codes stored in repositories.sync_error when a sync fails. They reach the
// client, so changing a value is a breaking API change (see docs/api.md).
const (
	CodeReauthRequired       = "reauth_required"
	CodeResourceNotFound     = "resource_not_found"
	CodeAppNotInstalled      = "app_not_installed"
	CodeRateLimited          = "rate_limited"
	CodeTruncatedTree        = "truncated_tree"
	CodeProviderNotSupported = "provider_not_supported"
	CodeInternal             = "internal"
)

// markFailedTimeout bounds the failure write, which runs detached from the job context
const markFailedTimeout = 5 * time.Second

// Service syncs the Markdown files of tracked repositories into the documents table
type Service struct {
	pool     *pgxpool.Pool
	creds    *credentials.Service
	registry *providers.Registry
}

// New returns a Service backed by pool, credentials and the provider registry
func New(pool *pgxpool.Pool, creds *credentials.Service, registry *providers.Registry) *Service {
	return &Service{
		pool:     pool,
		creds:    creds,
		registry: registry,
	}
}

// Sync runs a queued sync of repository repoID: it fetches the tracked branch and
// updates the stored documents if the branch moved. A stale job (the repository is no
// longer queued) returns nil. On failure, the error code is stored in sync_error and
// the full error is returned for logging.
func (s *Service) Sync(ctx context.Context, repoID int64) error {
	q := dal.New(s.pool)

	cnt, err := q.MarkRepositorySyncAsRunning(ctx, repoID)
	if err != nil {
		return fmt.Errorf("mark repo %d sync running: %w", repoID, err)
	}
	if cnt == 0 {
		return nil // stale job
	}

	err = s.sync(ctx, repoID)
	if err != nil {
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), markFailedTimeout)
		defer cancel()
		markErr := q.MarkRepositorySyncAsFailed(ctx, dal.MarkRepositorySyncAsFailedParams{
			ID:        repoID,
			SyncError: pgtype.Text{String: syncErrorCode(err), Valid: true},
		})
		if markErr != nil {
			log.Printf("failed to mark repo %d sync as failed, state stays 'running': %v", repoID, markErr)
		}
		return fmt.Errorf("sync repo %d: %w", repoID, err)
	}

	return nil
}

// sync does the work; Sync records the failure
func (s *Service) sync(ctx context.Context, repoID int64) error {
	q := dal.New(s.pool)

	repo, err := q.GetRepositoryByID(ctx, repoID)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return nil // deleted while the job was running
	case err != nil:
		return fmt.Errorf("get repo: %w", err)
	}

	prov, ok := s.registry.Lookup(repo.Provider)
	if !ok {
		return errProviderNotSupported
	}

	accessToken, err := s.creds.ForRepository(ctx, repo)
	if err != nil {
		return fmt.Errorf("get credentials: %w", err)
	}

	branch, err := prov.GetBranch(ctx, accessToken, repo.Owner, repo.Name, repo.TrackedBranch)
	if err != nil {
		return fmt.Errorf("get branch: %w", err)
	}

	// Up to date: only record the check. A row count of 0 means the tracked branch
	// changed meanwhile, which needs no handling.
	if repo.SyncedCommit.Valid && repo.SyncedCommit.String == branch.Commit {
		_, err := q.FinalizeRepositorySync(ctx, dal.FinalizeRepositorySyncParams{
			ID:            repoID,
			SyncedCommit:  repo.SyncedCommit,
			TrackedBranch: repo.TrackedBranch,
		})
		if err != nil {
			return fmt.Errorf("finalize repo sync: %w", err)
		}
		return nil
	}

	tree, err := prov.GetTree(ctx, accessToken, repo.Owner, repo.Name, branch.Commit)
	if err != nil {
		return fmt.Errorf("get tree: %w", err)
	}

	docs, err := q.ListDocumentShas(ctx, repoID)
	if err != nil {
		return fmt.Errorf("list stored documents: %w", err)
	}

	// Markdown files only, keyed by path
	liveTree := make(map[string]providers.TreeEntry, len(tree.Tree))
	for _, entry := range tree.Tree {
		if strings.HasSuffix(strings.ToLower(entry.Path), ".md") {
			liveTree[entry.Path] = entry
		}
	}
	storedTree := make(map[string]string, len(docs))
	for _, d := range docs {
		storedTree[d.Path] = d.BlobSha
	}

	var (
		added   []providers.TreeEntry
		changed []providers.TreeEntry
		removed []string
	)

	// compare the trees
	for path, entry := range liveTree {
		storedSha, stored := storedTree[path]
		if !stored {
			added = append(added, entry)
		} else if storedSha != entry.SHA {
			changed = append(changed, entry)
		}
	}

	for path := range storedTree {
		if _, live := liveTree[path]; !live {
			removed = append(removed, path)
		}
	}

	// Files that cannot be stored are skipped: a new one is not inserted, a changed one
	// keeps its old row (its sha still differs, so the next sync retries it). Any other
	// error fails the whole sync, so a partial result is never committed.
	entries := slices.Concat(added, changed)
	params := make([]dal.UpsertDocumentParams, 0, len(entries))
	for _, e := range entries {
		if e.Size > providers.MaxBlobContentBytes {
			log.Printf("sync repo %d: skip %s: blob too large (%d bytes)", repoID, e.Path, e.Size)
			continue
		}
		content, err := prov.GetBlob(ctx, accessToken, repo.Owner, repo.Name, e.SHA)
		switch {
		case errors.Is(err, providers.ErrContentTooLarge):
			// the tree size may be missing or stale: GetBlob enforces the limit anyway
			log.Printf("sync repo %d: skip %s: blob too large", repoID, e.Path)
			continue
		case err != nil:
			return fmt.Errorf("get blob %s: %w", e.Path, err)
		case !utf8.Valid(content) || bytes.Contains(content, []byte{0}):
			// Postgres TEXT requires valid UTF-8 without NUL bytes
			log.Printf("sync repo %d: skip %s: not valid UTF-8 text", repoID, e.Path)
			continue
		}
		params = append(params, dal.UpsertDocumentParams{
			RepositoryID: repoID,
			Path:         e.Path,
			BlobSha:      e.SHA,
			Content:      string(content),
		})
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	q = dal.New(tx)

	batchRes := q.UpsertDocument(ctx, params)
	var batchErr error
	batchRes.Exec(func(_ int, err error) {
		if err != nil && batchErr == nil {
			batchErr = err
		}
	})
	if batchErr != nil {
		return fmt.Errorf("upsert documents: %w", batchErr)
	}

	err = q.DeleteDocuments(ctx, dal.DeleteDocumentsParams{RepositoryID: repoID, Paths: removed})
	if err != nil {
		return fmt.Errorf("delete documents: %w", err)
	}

	cnt, err := q.FinalizeRepositorySync(ctx, dal.FinalizeRepositorySyncParams{
		ID:            repoID,
		SyncedCommit:  pgtype.Text{String: branch.Commit, Valid: true},
		TrackedBranch: repo.TrackedBranch,
	})
	if err != nil {
		return fmt.Errorf("finalize repo sync: %w", err)
	}

	// 0 rows: the tracked branch changed meanwhile, so the deferred rollback discards
	// the documents of the old branch
	if cnt > 0 {
		err = tx.Commit(ctx)
		if err != nil {
			return fmt.Errorf("commit transaction: %w", err)
		}
	}

	return nil
}

// syncErrorCode maps err to the stable code stored in sync_error. Error strings are
// never stored, since sync_error reaches the client.
func syncErrorCode(err error) string {
	switch {
	case errors.Is(err, credentials.ErrReauthRequired) || errors.Is(err, providers.ErrInvalidToken):
		return CodeReauthRequired
	case errors.Is(err, providers.ErrNotFound):
		return CodeResourceNotFound
	case errors.Is(err, providers.ErrAppNotInstalled):
		return CodeAppNotInstalled
	case errors.Is(err, providers.ErrRateLimited):
		return CodeRateLimited
	case errors.Is(err, providers.ErrTreeTruncated):
		return CodeTruncatedTree
	case errors.Is(err, errProviderNotSupported):
		return CodeProviderNotSupported
	default:
		return CodeInternal
	}
}
