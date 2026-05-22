package projects

// auth.go — admin auth middleware. projects-svc doesn't have its own
// session store; it asks dock to introspect Bearer tokens via
// /internal/v1/auth/verify (cached 30s in the SDK). Same shape as
// internal/plugins/packtunnel/auth.go.

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

const (
	ctxKeyUserID      = "user_id"
	ctxKeyUserRole    = "user_role"
	ctxKeyWorkspaceID = "workspace_id"
	ctxKeyUsername    = "username"
)

// requireAdminViaDock extracts Bearer → Dock.AuthVerify → role=admin.
// Sets user_id / user_role / workspace_id on the gin context.
func (p *Plugin) requireAdminViaDock() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractAccessToken(c)
		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing bearer token"})
			return
		}
		res, err := p.Dock.AuthVerify(token)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
			return
		}
		if !strings.EqualFold(res.Role, "admin") {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "admin role required"})
			return
		}
		c.Set(ctxKeyUserID, res.UserID)
		c.Set(ctxKeyUserRole, res.Role)
		c.Set(ctxKeyWorkspaceID, res.WorkspaceID)
		c.Next()
	}
}

// requireAuthViaDock — same Bearer + AuthVerify pattern but does NOT
// require admin role. Every authenticated user can hit project
// CRUD inside their own workspace.
func (p *Plugin) requireAuthViaDock() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractAccessToken(c)
		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing bearer token"})
			return
		}
		res, err := p.Dock.AuthVerify(token)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
			return
		}
		c.Set(ctxKeyUserID, res.UserID)
		c.Set(ctxKeyUserRole, res.Role)
		c.Set(ctxKeyWorkspaceID, res.WorkspaceID)
		c.Next()
	}
}

// extractAccessToken: Bearer header → ?access_token= → cookie.
func extractAccessToken(c *gin.Context) string {
	if v := strings.TrimSpace(c.GetHeader("Authorization")); v != "" {
		if strings.HasPrefix(strings.ToLower(v), "bearer ") {
			return strings.TrimSpace(v[7:])
		}
	}
	if v := strings.TrimSpace(c.Query("access_token")); v != "" {
		return v
	}
	if v, err := c.Cookie("access_token"); err == nil && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return ""
}

// requireWorkspaceID + requireUserID — small helpers mirroring dock's
// handler_helpers.go. The auth middleware always sets these context
// keys, so callers can treat the !ok branch as paranoia.
func requireWorkspaceID(c *gin.Context) (string, bool) {
	v, _ := c.Get(ctxKeyWorkspaceID)
	s, _ := v.(string)
	if strings.TrimSpace(s) == "" {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "workspace missing"})
		return "", false
	}
	return s, true
}

func requireUserID(c *gin.Context) (string, bool) {
	v, _ := c.Get(ctxKeyUserID)
	s, _ := v.(string)
	if strings.TrimSpace(s) == "" {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "user missing"})
		return "", false
	}
	return s, true
}
