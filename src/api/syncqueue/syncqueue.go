// Package syncqueue runs repository syncs in the background with a fixed pool of
// workers fed by a bounded in-memory queue.
//
// The queue is only a fast path: the database is the source of truth. A job lost
// from the channel (shutdown, crash) leaves its repository queued or running, and
// the startup reset re-enqueues it.
package syncqueue

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"
)

const (
	queueSize            = 100                    // jobs waiting for a worker
	numConcurrentWorkers = 10                     // syncs running at the same time
	workerTimeout        = 5 * time.Minute        // bounds a single job; this might be too much, let's see
	tryWriteTimeout      = 100 * time.Millisecond // how long Enqueue waits for a free slot
)

// Syncer runs the job for repository id. Workers call it concurrently, so an
// implementation must be safe for concurrent use.
type Syncer interface {
	Sync(ctx context.Context, id int64) error
}

// SyncPool is a fixed pool of workers that take repository ids from a bounded queue
// and sync them. Build it with New.
type SyncPool struct {
	jobs   chan int64 // each job is just an id
	syncer Syncer
	wg     sync.WaitGroup
}

// ErrQueueFull is returned by Enqueue when the queue has no free slot.
var ErrQueueFull = errors.New("jobs queue is full")

// New returns a SyncPool whose workers run their jobs with s. Call Start before
// enqueuing jobs that must run.
func New(s Syncer) *SyncPool {
	return &SyncPool{
		jobs:   make(chan int64, queueSize),
		syncer: s,
	}
}

// Start launches the workers and returns. The workers stop when ctx is cancelled, and
// ctx is the parent of every job context, so cancelling it also aborts running jobs.
func (sp *SyncPool) Start(ctx context.Context) {
	for range numConcurrentWorkers {
		sp.wg.Go(func() {
			for {
				select {
				case id := <-sp.jobs:
					sp.run(ctx, id)
				case <-ctx.Done():
					return
				}
			}
		})
	}
}

// Enqueue adds a job for request handlers, which must not block: if no slot frees up
// within tryWriteTimeout, it returns ErrQueueFull.
func (sp *SyncPool) Enqueue(ctx context.Context, id int64) error {
	// a short wait instead of failing at once: if a slot frees up in time, the
	// caller does not have to retry
	ctx, cancel := context.WithTimeout(ctx, tryWriteTimeout)
	defer cancel()

	select {
	case sp.jobs <- id:
		return nil
	case <-ctx.Done():
		return ErrQueueFull
	}
}

// EnqueueWait adds a job for background producers: it blocks until a slot is free, and
// returns ctx's error if ctx ends first.
func (sp *SyncPool) EnqueueWait(ctx context.Context, id int64) error {
	select {
	case sp.jobs <- id:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("enqueue: %w", ctx.Err())
	}
}

// Shutdown waits for the workers to return. It returns only after the ctx passed to
// Start is cancelled. Jobs still queued are dropped; their repositories stay queued
// in the database and are re-enqueued at the next startup.
func (sp *SyncPool) Shutdown() {
	// TODO: instead of relying only on the context cancellation from main, give
	// running jobs a grace period, then cancel them
	sp.wg.Wait()
}

// run runs one job with its own timeout, and recovers a panic so that a single bad
// repository cannot crash the server.
func (sp *SyncPool) run(ctx context.Context, id int64) {
	ctx, cancel := context.WithTimeout(ctx, workerTimeout)
	defer cancel()

	defer func() {
		if r := recover(); r != nil {
			log.Printf("worker: repo %d panicked: %v", id, r)
		}
	}()

	err := sp.syncer.Sync(ctx, id)
	if err != nil {
		log.Printf("worker: %v", err)
	}
}
