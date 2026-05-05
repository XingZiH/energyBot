package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/anomalyco/energybot-bot/internal/botruntime"
	"github.com/anomalyco/energybot-bot/internal/config"
	"github.com/anomalyco/energybot-bot/internal/executor"
	"github.com/anomalyco/energybot-bot/internal/scheduler"
	"github.com/anomalyco/energybot-bot/internal/storage"
)

func main() {
	log.SetOutput(os.Stdout)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := config.LoadRuntimeFromEnv(ctx)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	db, err := storage.Open(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("open sqlite: %v", err)
	}
	defer func() { _ = db.Close() }()

	executorService, err := executor.New(cfg, db, log.Default())
	if err != nil {
		log.Fatalf("create executor: %v", err)
	}

	worker, err := scheduler.New(cfg.WorkerInterval, executorService.RunOnce)
	if err != nil {
		log.Fatalf("create scheduler: %v", err)
	}

	runtimeManager, err := botruntime.NewManager(cfg, db, log.Default())
	if err != nil {
		log.Fatalf("create bot runtime manager: %v", err)
	}

	log.Println("go-bot executor started")
	errCh := make(chan error, 2)

	go func() {
		errCh <- worker.Run(ctx)
	}()
	go func() {
		errCh <- runtimeManager.Run(ctx)
	}()

	select {
	case <-ctx.Done():
		return
	case err := <-errCh:
		if err != nil && !errors.Is(err, context.Canceled) {
			log.Fatal(fmt.Errorf("run bot executor: %w", err))
		}
	}
}
