// Package projects is the AI-driven product workflow plugin
// (projects + project_features + project_tasks + project_task_revisions
// + project_task_retrospects + project_research_runs).
//
// Phase 2-W4 skeleton: DB pool + heartbeat + /healthz only. Handler
// PR moves the 2 dock files (projects_handlers.go ~1.1K LOC,
// projects_store.go ~820 LOC) across.
//
// Cross-domain refs use dock SDK (`gin-auth-app/internal/plugins/sdk`):
//   - chat_thread_id / llm_thread_id stay BIGINT pointers into dock's
//     chat_threads + llm_threads tables (dock owns those)
//   - iosdist_app_id stays BIGINT pointer into polar_iosdist
//   - bot_user_id → dock SDK /internal/v1/users/:id
//   - llm_config_id → dock SDK /internal/v1/llm-configs/:id
package projects

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"runtime"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/networkextension/polar-sdk"
)

type Plugin struct {
	DB         *sql.DB
	Dock       *sdk.Client
	Name       string
	Listen     string
	Ver        string
	BlobDir    string // $POLAR_PROJECTS_BLOB_DIR — research-mode artifacts, generated docs
	MetricsTok string

	// SystemWorkspaceID is dock's "system" user's personal team. Some
	// projects flows (research-mode auto-bot, system templates) need
	// to stamp this workspace_id. Resolved once at New() via
	// /internal/v1/users/system/workspace.
	SystemWorkspaceID string

	// Cross-domain glue. aiAgent owns the dispatch path
	// (sync chat completion + async enqueue); agentHub owns the
	// bot↔polar-agent presence lookup. Both are SDK-backed shims
	// defined in stubs.go.
	aiAgent  *aiAgentStub
	agentHub *agentHubStub

	metrics   *projectsMetrics
	startedAt time.Time
}

type Config struct {
	DBDSN        string
	DockBase     string
	PluginName   string
	PluginToken  string
	Listen       string
	BuildVersion string
	BlobDir      string
	MetricsToken string
}

func New(ctx context.Context, cfg Config) (*Plugin, error) {
	cfg.PluginName = strings.TrimSpace(cfg.PluginName)
	if cfg.PluginName == "" {
		cfg.PluginName = "projects"
	}
	if strings.TrimSpace(cfg.DBDSN) == "" {
		return nil, errors.New("projects.New: DBDSN required")
	}
	if strings.TrimSpace(cfg.DockBase) == "" {
		return nil, errors.New("projects.New: DockBase required")
	}
	if strings.TrimSpace(cfg.PluginToken) == "" {
		return nil, errors.New("projects.New: PluginToken required")
	}
	if strings.TrimSpace(cfg.BlobDir) == "" {
		return nil, errors.New("projects.New: BlobDir required")
	}

	db, err := sql.Open("postgres", cfg.DBDSN)
	if err != nil {
		return nil, fmt.Errorf("open polar_projects: %w", err)
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(30 * time.Minute)
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping polar_projects: %w", err)
	}

	dock := sdk.NewClient(cfg.DockBase, cfg.PluginName, sdk.DeriveHMACKey(cfg.PluginToken))
	resp, err := dock.Do(http.MethodGet, "/internal/v1/ping", nil)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("dock ping: %w", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_ = db.Close()
		return nil, fmt.Errorf("dock /ping rejected: HTTP %d", resp.StatusCode)
	}

	// Pre-fetch system workspace ID — mirrors packtunnel's pattern.
	// If dock hasn't bootstrapped the system user, log + continue with
	// empty so a clean DB-side error surfaces later instead of a
	// surprise 500.
	sysWS, sysErr := dock.Do(http.MethodGet, "/internal/v1/users/system/workspace", nil)
	systemWorkspaceID := ""
	if sysErr == nil {
		var body struct {
			WorkspaceID string `json:"workspace_id"`
		}
		if err := readJSON(sysWS, &body); err == nil {
			systemWorkspaceID = body.WorkspaceID
		}
	}
	if systemWorkspaceID == "" {
		log.Printf("projects: WARN system workspace lookup failed; some flows may 500 until dock bootstraps system user (err=%v)", sysErr)
	}

	p := &Plugin{
		DB:                db,
		Dock:              dock,
		Name:              cfg.PluginName,
		Listen:            cfg.Listen,
		Ver:               cfg.BuildVersion,
		BlobDir:           cfg.BlobDir,
		MetricsTok:        cfg.MetricsToken,
		SystemWorkspaceID: systemWorkspaceID,
		metrics:           newProjectsMetrics(),
		startedAt:         time.Now(),
	}
	p.attachAIAgent()
	return p, nil
}

// readJSON — local helper mirroring packtunnel's; SDK has the same
// method but it's unexported.
func readJSON(resp *http.Response, out any) error {
	defer resp.Body.Close()
	return json.NewDecoder(resp.Body).Decode(out)
}

func (p *Plugin) RegisterRoutes(r gin.IRouter) {
	r.GET("/healthz", p.handleHealthz)
	r.GET("/metrics", p.handleMetricsExposition)

	// /api/projects/* — mirrors dock-side routes so nginx can flip
	// over with a single proxy_pass redirect. All routes require an
	// authenticated user (workspace scoping happens inside each
	// handler via the user's workspace_id). No admin gate — every
	// user manages projects inside their own workspace.
	api := r.Group("/api", p.requireAuthViaDock())
	{
		api.GET("/projects", p.handleProjectList)
		api.POST("/projects", p.handleProjectCreate)
		api.GET("/projects/:id", p.handleProjectDetail)
		api.PUT("/projects/:id", p.handleProjectUpdate)
		api.DELETE("/projects/:id", p.handleProjectDelete)
		api.POST("/projects/:id/decompose", p.handleProjectDecompose)
		api.PUT("/projects/:id/features/:feature_id", p.handleProjectFeatureUpdate)
		api.DELETE("/projects/:id/features/:feature_id", p.handleProjectFeatureDelete)
		api.POST("/projects/:id/plan", p.handleProjectGeneratePlan)
		api.PUT("/projects/:id/tasks/:task_id", p.handleProjectTaskUpdate)
		api.POST("/projects/:id/tasks/:task_id/pickup", p.handleProjectTaskPickup)
		api.POST("/projects/:id/tasks/bulk-status", p.handleProjectTaskBulkStatus)
	}
}

func (p *Plugin) Start(ctx context.Context) {
	go p.heartbeatLoop(ctx)
}

func (p *Plugin) Close() error {
	if p.DB != nil {
		return p.DB.Close()
	}
	return nil
}

func (p *Plugin) handleHealthz(c *gin.Context) {
	dbOK := true
	if err := p.DB.PingContext(c.Request.Context()); err != nil {
		dbOK = false
	}
	status := http.StatusOK
	if !dbOK {
		status = http.StatusServiceUnavailable
	}
	c.JSON(status, gin.H{
		"plugin":         p.Name,
		"version":        p.Ver,
		"uptime_seconds": int64(time.Since(p.startedAt).Seconds()),
		"db_ok":          dbOK,
		"blob_dir":       p.BlobDir,
		"go":             runtime.Version(),
	})
}

func (p *Plugin) handleMetricsExposition(c *gin.Context) {
	if p.MetricsTok == "" {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}
	if c.GetHeader("Authorization") != "Bearer "+p.MetricsTok {
		c.Header("WWW-Authenticate", `Bearer realm="metrics"`)
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	promhttp.HandlerFor(p.metrics.registry, promhttp.HandlerOpts{}).ServeHTTP(c.Writer, c.Request)
}

func (p *Plugin) heartbeatLoop(ctx context.Context) {
	p.beat(ctx)
	t := time.NewTicker(60 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			p.beat(ctx)
		}
	}
}

func (p *Plugin) beat(_ context.Context) {
	err := p.Dock.Heartbeat(sdk.HeartbeatOpts{
		Version:       p.Ver,
		Endpoint:      p.Listen,
		UptimeSeconds: int64(time.Since(p.startedAt).Seconds()),
	})
	if err != nil {
		log.Printf("projects: heartbeat failed: %v", err)
	}
}

type projectsMetrics struct {
	registry *prometheus.Registry
	upGauge  prometheus.Gauge
}

func newProjectsMetrics() *projectsMetrics {
	m := &projectsMetrics{registry: prometheus.NewRegistry()}
	m.upGauge = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "polar_projects_up",
		Help: "Always 1 while projects-svc is serving. Phase 2-W4 placeholder.",
	})
	m.registry.MustRegister(m.upGauge)
	m.upGauge.Set(1)
	return m
}
