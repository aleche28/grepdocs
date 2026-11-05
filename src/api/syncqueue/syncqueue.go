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
	queueSize            = 100
	numConcurrentWorkers = 10
	workerTimeout        = 5 * time.Minute // this might be too much, let's see
	tryWriteTimeout      = 100 * time.Millisecond
)

type Syncer interface {
	Sync(ctx context.Context, id int64) error
}

type SyncPool struct {
	jobs   chan int64 // each job is just an id
	syncer Syncer
	wg     sync.WaitGroup
}

// ErrQueueFull is returned when jobs queue is full and a new job cannot be enqueue
// without waiting
var ErrQueueFull = errors.New("jobs queue is full")

// New creates a new SyncPool with Syncer as worker interface
func New(s Syncer) *SyncPool {
	return &SyncPool{
		jobs:   make(chan int64, queueSize),
		syncer: s,
	}
}

// Start spins up the pool workers and returns
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

// Enqueue (non-blocking) tries to enqueue a new job in the queue,
// failing and returning immediately if the queue is full
func (sp *SyncPool) Enqueue(ctx context.Context, id int64) error {
	// instead of immediately failing when full, let's use a short timeout:
	// if the queue frees up a place fast enough, we can write without wasting
	// too much time and the caller is happy!
	ctx, cancel := context.WithTimeout(ctx, tryWriteTimeout)
	defer cancel()

	select {
	case sp.jobs <- id:
		return nil
	case <-ctx.Done():
		return ErrQueueFull
	}
}

// EnqueueWait is the blocking version of Enqueue: if the queue is full,
// it waits until one spot is freed, adds the job to queue and returns
func (sp *SyncPool) EnqueueWait(ctx context.Context, id int64) error {
	select {
	case sp.jobs <- id:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("enqueue: %w", ctx.Err())
	}
}

// Shutdown waits for all workers to terminate and release resources
func (sp *SyncPool) Shutdown() {
	// TODO: instead of relying only on the context cancellation from main,
	// here have grace period after which a termination signal is sent to all
	// running workers
	sp.wg.Wait()
}

// run wraps timeout and panic recovery around the Sync function
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
