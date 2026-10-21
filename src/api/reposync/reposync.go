package reposync

import (
	"context"
	"errors"
	"fmt"
	"grepdocs/api/credentials"
	"grepdocs/api/dal"
	"grepdocs/api/providers"
	"log"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

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
		ctx = context.WithoutCancel(ctx)
		ctx, cancel := context.WithTimeout(ctx, 5)
		defer cancel()
		markErr := q.MarkRepositorySyncAsFailed(context.WithoutCancel(ctx), dal.MarkRepositorySyncAsFailedParams{
			ID:        repoID,
			SyncError: pgtype.Text{String: syncErrorCode(err), Valid: true},
		})
		if markErr != nil {
			log.Printf("failed to mark repo %d sync as failed, state stays 'running': %w", markErr)
		}
		return fmt.Errorf("sync repo %d: %w", repoID, err)
	}

	return nil
}

// sentinel errors
// i don't know if this design is okay: it hides the underlying errors (except for repo not found)
// cause it does not allow wrapping, so the originating error is lost
var (
	errRepoNotFound         = errors.New("repo not found")
	errProviderNotSupported = errors.New("provider not supported")
)

// internal sync implementation, wraps internal errors, so that the public caller Sync()
// can then mark sync as failed in case of error
func (s *Service) sync(ctx context.Context, repoID int64) error {
	q := dal.New(s.pool)

	repo, err := q.GetRepositoryByID(ctx, repoID)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return errRepoNotFound
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

	// TODO: fetch new file tree and file contents, update them in db

	if repo.SyncedCommit.Valid && repo.SyncedCommit.String == branch.Commit {
		_, err := q.FinalizeRepositorySync(ctx, dal.FinalizeRepositorySyncParams{
			ID:            repoID,
			SyncedCommit:  repo.SyncedCommit,
			TrackedBranch: repo.TrackedBranch,
		})
		if err != nil {
			return fmt.Errorf("error while finalizing repo sync: %w", err)
		}
	}

	return nil
}

func syncErrorCode(err error) string {
	switch {
	case errors.Is(err, credentials.ErrReauthRequired):
		return "reauth_required"
	case errors.Is(err, providers.ErrNotFound):
		return "provider_resource_not_found"
	case errors.Is(err, providers.ErrAppNotInstalled):
		return "app_not_installed"
	case errors.Is(err, providers.ErrRateLimited):
		return "provider_rate_limit"
	case errors.Is(err, providers.ErrTreeTruncated):
		return "provider_tree_truncated"
	case errors.Is(err, errProviderNotSupported):
		return "provider_not_supported"
	default:
		return "internal"
	}
}
