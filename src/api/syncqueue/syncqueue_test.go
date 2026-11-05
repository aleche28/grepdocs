package syncqueue

import (
	"context"
	"errors"
	"slices"
	"sync"
	"testing"
	"testing/synctest"
	"time"
)

// The tests run in synctest bubbles: time is fake, so timeouts elapse at once and
// exactly, and synctest.Wait returns once every goroutine of the bubble is blocked.
// Pools, contexts and channels must be created inside the bubble.

// syncerFunc adapts a function to the Syncer interface
type syncerFunc func(ctx context.Context, id int64) error

func (f syncerFunc) Sync(ctx context.Context, id int64) error { return f(ctx, id) }

// recorder is a Syncer that records the ids it synced
type recorder struct {
	mu  sync.Mutex
	ids []int64
}

func (r *recorder) Sync(_ context.Context, id int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.ids = append(r.ids, id)
	return nil
}

// synced returns the recorded ids, sorted: workers run jobs in no particular order
func (r *recorder) synced() []int64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	ids := slices.Clone(r.ids)
	slices.Sort(ids)
	return ids
}

// startPool starts a pool that syncs with s, and stops it when the test ends
func startPool(t *testing.T, s Syncer) *SyncPool {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	sp := New(s)
	sp.Start(ctx)
	t.Cleanup(func() {
		cancel()
		sp.Shutdown()
	})
	return sp
}

// fillQueue takes every slot of the queue of a pool whose workers are not started
func fillQueue(t *testing.T, sp *SyncPool) {
	t.Helper()
	for id := range int64(queueSize) {
		if err := sp.Enqueue(context.Background(), id); err != nil {
			t.Fatalf("Enqueue(%d) with free slots: %v", id, err)
		}
	}
}

func TestWorkersRunEnqueuedJobs(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		rec := &recorder{}
		sp := startPool(t, rec)

		var want []int64
		for id := range int64(3 * numConcurrentWorkers) {
			enqueue := sp.Enqueue
			if id%2 == 1 {
				enqueue = sp.EnqueueWait
			}
			if err := enqueue(context.Background(), id); err != nil {
				t.Fatalf("enqueue %d: %v", id, err)
			}
			want = append(want, id)
		}
		synctest.Wait()

		if got := rec.synced(); !slices.Equal(got, want) {
			t.Errorf("synced ids = %v, want %v", got, want)
		}
	})
}

func TestWorkersRunAtMostNumConcurrentWorkersJobs(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		var (
			mu         sync.Mutex
			running    int
			maxRunning int
			finished   int
		)
		release := make(chan struct{})
		sp := startPool(t, syncerFunc(func(context.Context, int64) error {
			mu.Lock()
			running++
			maxRunning = max(maxRunning, running)
			mu.Unlock()

			<-release

			mu.Lock()
			running--
			finished++
			mu.Unlock()
			return nil
		}))

		const jobs = 2 * numConcurrentWorkers
		for id := range int64(jobs) {
			if err := sp.Enqueue(context.Background(), id); err != nil {
				t.Fatalf("Enqueue(%d): %v", id, err)
			}
		}
		synctest.Wait() // every worker is blocked on release

		mu.Lock()
		if running != numConcurrentWorkers {
			t.Errorf("running jobs = %d, want %d", running, numConcurrentWorkers)
		}
		mu.Unlock()

		close(release)
		synctest.Wait()

		mu.Lock()
		defer mu.Unlock()
		if finished != jobs {
			t.Errorf("finished jobs = %d, want %d", finished, jobs)
		}
		if maxRunning != numConcurrentWorkers {
			t.Errorf("max concurrent jobs = %d, want %d", maxRunning, numConcurrentWorkers)
		}
	})
}

func TestEnqueueReturnsErrQueueFull(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		sp := New(&recorder{}) // workers not started: nothing drains the queue
		fillQueue(t, sp)

		start := time.Now()
		err := sp.Enqueue(context.Background(), queueSize)
		if !errors.Is(err, ErrQueueFull) {
			t.Fatalf("Enqueue on a full queue: err = %v, want %v", err, ErrQueueFull)
		}
		if waited := time.Since(start); waited != tryWriteTimeout {
			t.Errorf("Enqueue waited %v, want %v", waited, tryWriteTimeout)
		}
	})
}

func TestEnqueueTakesSlotFreedWithinTimeout(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		sp := New(&recorder{})
		fillQueue(t, sp)

		go func() {
			time.Sleep(tryWriteTimeout / 2)
			<-sp.jobs // a worker takes a job
		}()

		if err := sp.Enqueue(context.Background(), queueSize); err != nil {
			t.Fatalf("Enqueue with a slot freed in time: %v", err)
		}
		if n := len(sp.jobs); n != queueSize {
			t.Errorf("queued jobs = %d, want %d", n, queueSize)
		}
	})
}

func TestEnqueueWaitBlocksUntilSlotIsFree(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		sp := New(&recorder{})
		fillQueue(t, sp)

		errc := make(chan error, 1)
		go func() { errc <- sp.EnqueueWait(context.Background(), queueSize) }()

		// far longer than Enqueue would wait
		time.Sleep(time.Hour)
		synctest.Wait()
		select {
		case err := <-errc:
			t.Fatalf("EnqueueWait on a full queue returned %v, want it to block", err)
		default:
		}

		<-sp.jobs // a worker takes a job
		if err := <-errc; err != nil {
			t.Fatalf("EnqueueWait after a slot freed: %v", err)
		}
		if n := len(sp.jobs); n != queueSize {
			t.Errorf("queued jobs = %d, want %d", n, queueSize)
		}
	})
}

func TestEnqueueWaitReturnsWhenContextEnds(t *testing.T) {
	tests := []struct {
		name    string
		ctx     func() (context.Context, context.CancelFunc)
		wantErr error
	}{
		{
			name: "cancelled",
			ctx: func() (context.Context, context.CancelFunc) {
				ctx, cancel := context.WithCancel(context.Background())
				cancel()
				return ctx, cancel
			},
			wantErr: context.Canceled,
		},
		{
			name: "deadline exceeded",
			ctx: func() (context.Context, context.CancelFunc) {
				return context.WithTimeout(context.Background(), time.Minute)
			},
			wantErr: context.DeadlineExceeded,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				sp := New(&recorder{})
				// a full queue, or select could take the free slot over the done context
				fillQueue(t, sp)

				ctx, cancel := tt.ctx()
				defer cancel()

				err := sp.EnqueueWait(ctx, queueSize)
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("EnqueueWait: err = %v, want %v", err, tt.wantErr)
				}
			})
		})
	}
}

func TestWorkerSurvivesFailingJob(t *testing.T) {
	tests := []struct {
		name string
		fail func() error
	}{
		{name: "error", fail: func() error { return errors.New("sync failed") }},
		{name: "panic", fail: func() error { panic("sync panicked") }},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				const badID = -1
				rec := &recorder{}
				sp := startPool(t, syncerFunc(func(ctx context.Context, id int64) error {
					if id == badID {
						return tt.fail()
					}
					return rec.Sync(ctx, id)
				}))

				// one failing job per worker: if a failure stopped the worker that ran
				// it, none would be left for the next job
				for range numConcurrentWorkers {
					if err := sp.Enqueue(context.Background(), badID); err != nil {
						t.Fatalf("Enqueue(%d): %v", badID, err)
					}
				}
				synctest.Wait()

				if err := sp.Enqueue(context.Background(), 1); err != nil {
					t.Fatalf("Enqueue(1): %v", err)
				}
				synctest.Wait()

				if got := rec.synced(); !slices.Equal(got, []int64{1}) {
					t.Errorf("synced ids = %v, want [1]", got)
				}
			})
		})
	}
}

func TestJobTimesOutAfterWorkerTimeout(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		type result struct {
			elapsed time.Duration
			err     error
		}
		results := make(chan result, 1)
		sp := startPool(t, syncerFunc(func(ctx context.Context, _ int64) error {
			start := time.Now()
			<-ctx.Done() // a job that never finishes on its own
			results <- result{elapsed: time.Since(start), err: ctx.Err()}
			return ctx.Err()
		}))

		if err := sp.Enqueue(context.Background(), 1); err != nil {
			t.Fatalf("Enqueue(1): %v", err)
		}

		got := <-results
		if !errors.Is(got.err, context.DeadlineExceeded) {
			t.Errorf("job context err = %v, want %v", got.err, context.DeadlineExceeded)
		}
		if got.elapsed != workerTimeout {
			t.Errorf("job ran for %v, want %v", got.elapsed, workerTimeout)
		}
	})
}

func TestShutdownReturnsOnlyAfterStartContextIsCancelled(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		sp := New(&recorder{})
		sp.Start(ctx)

		returned := make(chan struct{})
		go func() {
			sp.Shutdown()
			close(returned)
		}()

		synctest.Wait()
		select {
		case <-returned:
			t.Fatal("Shutdown returned before the Start context was cancelled")
		default:
		}

		cancel()
		<-returned // a deadlock here fails the test
	})
}

func TestShutdownCancelsAndWaitsForRunningJobs(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		const windDown = time.Second
		jobErr := make(chan error, 1)
		sp := New(syncerFunc(func(ctx context.Context, _ int64) error {
			<-ctx.Done()
			time.Sleep(windDown) // the job takes a while to return
			jobErr <- ctx.Err()
			return ctx.Err()
		}))

		ctx, cancel := context.WithCancel(context.Background())
		sp.Start(ctx)
		if err := sp.Enqueue(context.Background(), 1); err != nil {
			t.Fatalf("Enqueue(1): %v", err)
		}
		synctest.Wait() // the job is running

		cancel()
		start := time.Now()
		sp.Shutdown()
		if waited := time.Since(start); waited != windDown {
			t.Errorf("Shutdown waited %v, want %v", waited, windDown)
		}

		// reposync tells a shutdown from a failure by context.Canceled: a deadline
		// error here would mark the interrupted sync as failed
		if err := <-jobErr; !errors.Is(err, context.Canceled) {
			t.Errorf("job context err = %v, want %v", err, context.Canceled)
		}
	})
}
