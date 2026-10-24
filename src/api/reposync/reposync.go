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

const markFailedTimeout time.Duration = 5 * time.Second

type Service struct {
	pool     *pgxpool.Pool
	creds    *credentials.Service
	registry *providers.Registry
}

// New returns a Service backed by pool, credentials and provider registry
func New(pool *pgxpool.Pool, creds *credentials.Service, registry *providers.Registry) *Service {
	return &Service{
		pool:     pool,
		creds:    creds,
		registry: registry,
	}
}

// Sync fetches tracked branch for repository repoID and updates tracked files if changed
func (s *Service) Sync(ctx context.Context, repoID int64) error {
	q := dal.New(s.pool)

	cnt, err := q.MarkRepositorySyncAsRunning(ctx, repoID)
	if err != nil {
		return fmt.Errorf("error while marking repo sync running: %w", err)
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

// does the work, Sync records the failure
func (s *Service) sync(ctx context.Context, repoID int64) error {
	q := dal.New(s.pool)

	repo, err := q.GetRepositoryByID(ctx, repoID)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return nil
	case err != nil:
		return fmt.Errorf("error while fetching repo: %w", err)
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

	if repo.SyncedCommit.Valid && repo.SyncedCommit.String == branch.Commit {
		_, err := q.FinalizeRepositorySync(ctx, dal.FinalizeRepositorySyncParams{})
		switch {
		case err != nil && !errors.Is(err, pgx.ErrNoRows):
			return fmt.Errorf("finalize repo sync: %w", err)
		}
		return nil
	}

	tree, err := prov.GetTree(ctx, accessToken, repo.Owner, repo.Name, branch.Commit)
	if err != nil {
		return fmt.Errorf("get tree: %w", err)
	}

	mdfiles := make([]providers.TreeEntry, 0, len(tree.Tree))
	for _, entry := range tree.Tree {
		if strings.HasSuffix(strings.ToLower(entry.Path), ".md") {
			mdfiles = append(mdfiles, entry)
		}
	}

	docs, err := q.ListDocumentShas(ctx, repoID)
	if err != nil {
		return fmt.Errorf("get repo stored docs: %w", err)
	}

	liveTree := make(map[string]providers.TreeEntry, len(mdfiles))
	for _, f := range mdfiles {
		liveTree[f.Path] = f
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
		if _, skip := liveTree[path]; !skip {
			removed = append(removed, path)
		}
	}

	entries := slices.Concat(added, changed)
	params := make([]dal.UpsertDocumentParams, 0, len(entries))
	for _, e := range entries {
		if e.Size > providers.MaxBlobContentBytes {
			// log and skip insert/update
			log.Printf("get blob repo id %d and path %s: content too large", repoID, e.Path)
			continue
		}
		content, err := prov.GetBlob(ctx, accessToken, repo.Owner, repo.Name, e.SHA)
		switch {
		case err != nil:
			return fmt.Errorf("get blob %s: %w", e.Path, err)
		case !utf8.Valid(content) || bytes.Contains(content, []byte{0}):
			log.Printf("blob content for repo id %d and path %s is invalid", repoID, e.Path)
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

	if cnt > 0 {
		err = tx.Commit(ctx)
		if err != nil {
			return fmt.Errorf("commit transaction: %w", err)
		}
	}

	return nil
}

// maps error to corresponding string code
func syncErrorCode(err error) string {
	switch {
	case errors.Is(err, credentials.ErrReauthRequired) || errors.Is(err, providers.ErrInvalidToken):
		return "reauth_required"
	case errors.Is(err, providers.ErrNotFound):
		return "resource_not_found"
	case errors.Is(err, providers.ErrAppNotInstalled):
		return "app_not_installed"
	case errors.Is(err, providers.ErrRateLimited):
		return "rate_limited"
	case errors.Is(err, providers.ErrTreeTruncated):
		return "truncated_tree"
	case errors.Is(err, errProviderNotSupported):
		return "provider_not_supported"
	default:
		return "internal"
	}
}
