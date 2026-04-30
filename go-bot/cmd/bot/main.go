package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/jackc/pgx/v5/pgxpool"

	"ng-antd-admin/go-bot/internal/botruntime"
	"ng-antd-admin/go-bot/internal/config"
	"ng-antd-admin/go-bot/internal/executor"
	"ng-antd-admin/go-bot/internal/scheduler"
)

func main() {
	log.SetOutput(os.Stdout)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := config.LoadRuntimeFromEnv(ctx)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	db, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("connect database: %v", err)
	}
	defer db.Close()

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
