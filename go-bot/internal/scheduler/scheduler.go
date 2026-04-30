package scheduler

import (
	"context"
	"errors"
	"time"
)

type Job func(context.Context) error

type Scheduler struct {
	interval time.Duration
	job      Job
}

func New(interval time.Duration, job Job) (*Scheduler, error) {
	if interval <= 0 {
		return nil, errors.New("scheduler interval must be positive")
	}
	if job == nil {
		return nil, errors.New("scheduler job is required")
	}
	return &Scheduler{interval: interval, job: job}, nil
}

func (s *Scheduler) Run(ctx context.Context) error {
	if err := s.job(ctx); err != nil {
		return err
	}

	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := s.job(ctx); err != nil {
				return err
			}
		}
	}
}
