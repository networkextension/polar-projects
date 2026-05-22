// Command projects-svc is the AI-driven product workflow plugin
// binary. Phase 2-W4 skeleton.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"

	"github.com/networkextension/polar-projects/internal/projects"
)

func main() {
	cfg := projects.Config{
		DBDSN:        envOrDefault("POLAR_PROJECTS_DB_DSN", "postgres://ideamesh:test123456@127.0.0.1:5432/polar_projects?sslmode=disable"),
		DockBase:     envOrDefault("POLAR_DOCK_BASE", "http://127.0.0.1:8080"),
		PluginName:   envOrDefault("POLAR_PLUGIN_NAME", "projects"),
		PluginToken:  os.Getenv("POLAR_PLUGIN_TOKEN"),
		Listen:       envOrDefault("POLAR_PROJECTS_LISTEN", "127.0.0.1:8096"),
		BuildVersion: envOrDefault("POLAR_PROJECTS_VERSION", "0.0.1"),
		BlobDir:      envOrDefault("POLAR_PROJECTS_BLOB_DIR", "/Users/local/projects-svc-data"),
		MetricsToken: os.Getenv("POLAR_PROJECTS_METRICS_TOKEN"),
	}
	if strings.TrimSpace(cfg.PluginToken) == "" {
		log.Fatal("POLAR_PLUGIN_TOKEN unset — get plaintext from /admin-plugins.html")
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	plugin, err := projects.New(ctx, cfg)
	if err != nil {
		log.Fatalf("projects.New: %v", err)
	}
	defer plugin.Close()

	gin.SetMode(envOrDefault("GIN_MODE", gin.ReleaseMode))
	r := gin.New()
	r.Use(gin.Recovery())
	plugin.RegisterRoutes(r)
	plugin.Start(ctx)

	srv := &http.Server{Addr: cfg.Listen, Handler: r, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		log.Printf("projects-svc listening on %s (dock=%s, name=%s, ver=%s, blob=%s)",
			cfg.Listen, cfg.DockBase, cfg.PluginName, cfg.BuildVersion, cfg.BlobDir)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("ListenAndServe: %v", err)
		}
	}()

	<-ctx.Done()
	log.Print("projects-svc: shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("projects-svc: shutdown: %v", err)
	}
}

func envOrDefault(key, fallback string) string {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	return v
}
