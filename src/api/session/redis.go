package session

import (
	"context"
	"encoding/json"
	"grepdocs/api/models"
	"time"

	"github.com/redis/go-redis/v9"
)

type RedisSessionStore struct {
	client             *redis.Client
	idleExpiration     time.Duration
	absoluteExpiration time.Duration
}

func NewRedisSessionStore(
	address string,
	password string,
	idleExpiration time.Duration,
	absoluteExpiration time.Duration,
) *RedisSessionStore {
	rss := &RedisSessionStore{
		client: redis.NewClient(&redis.Options{
			Addr:     address,
			Password: password,
			DB:       0,
			Protocol: 2,
		}),
		idleExpiration:     idleExpiration,
		absoluteExpiration: absoluteExpiration,
	}

	return rss
}

func (s *RedisSessionStore) Read(ctx context.Context, id string) (*models.Session, error) {
	val, err := s.client.Get(ctx, id).Bytes()
	if err != nil {
		if err == redis.Nil {
			return nil, nil
		}
		return nil, err
	}

	var session models.Session
	if err := json.Unmarshal(val, &session); err != nil {
		return nil, err
	}

	return &session, nil
}

func (s *RedisSessionStore) Write(ctx context.Context, session *models.Session) error {
	blob, err := json.Marshal(session)
	if err != nil {
		return err
	}

	// Calculate time remaining until absolute expiration
	timeUntilAbsoluteExpiry := s.absoluteExpiration - time.Since(session.CreatedAt)

	// Use the minimum of idle timeout and remaining absolute time
	ttl := min(s.idleExpiration, timeUntilAbsoluteExpiry)

	if ttl <= 0 {
		// Session has exceeded absolute expiration
		return s.Destroy(ctx, session.Id)
	}

	return s.client.Set(ctx, session.Id, blob, ttl).Err()
}

func (s *RedisSessionStore) Destroy(ctx context.Context, id string) error {
	return s.client.Del(ctx, id).Err()
}

func (s *RedisSessionStore) Gc(ctx context.Context, idleExpiration, absoluteExpiration time.Duration) error {
	// Not needed: Redis handles TTL expiration for you
	return nil
}

func (s *RedisSessionStore) NeedsGC() bool {
	return false
}
