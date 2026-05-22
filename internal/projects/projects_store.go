package projects

// Storage layer for projects + features + tasks. Tables are
// declared in store.go's openDB() schema. The full pipeline:
//   project (description) → AI decompose → project_features
//                                          → user picks → project_tasks
//                                          → bot picks task → chat_thread bound
//                                          → bot codes → IPA / OTA dist

import (
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/lib/pq"
)

const (
	ProjectStatusDraft    = "draft"
	ProjectStatusPlanning = "planning"
	ProjectStatusBuilding = "building"
	ProjectStatusBeta     = "beta"
	ProjectStatusShipped  = "shipped"
	ProjectStatusArchived = "archived"

	ProjectFeatureComplexitySimple = "simple"
	ProjectFeatureComplexityMedium = "medium"
	ProjectFeatureComplexityComplex = "complex"

	ProjectTaskStatusTodo       = "todo"
	ProjectTaskStatusInProgress = "in_progress"
	ProjectTaskStatusReview     = "review"
	ProjectTaskStatusDone       = "done"
	ProjectTaskStatusBlocked    = "blocked"
)

type Project struct {
	ID               string    `json:"id"`
	WorkspaceID      string    `json:"workspace_id"`
	CreatorUserID    string    `json:"creator_user_id"`
	Name             string    `json:"name"`
	Description      string    `json:"description"`
	Status           string    `json:"status"`
	Template         string    `json:"template"`
	RuntimeEnv       string    `json:"runtime_env"`
	BusinessScenario string    `json:"business_scenario"`
	CodeProvider     string    `json:"code_provider"`
	// CurrentSprint: monotonically increases each AI 拆解 run.
	// 0 = no sprint yet (just-created project). 1 = first decompose.
	// Features and tasks tag themselves with this number on insert
	// so the UI can group by sprint.
	CurrentSprint int `json:"current_sprint"`
	// GitRemoteURL: optional git remote (ssh or https) where the
	// polar-agent pushes whatever the coder tool produced. Empty
	// disables the agent's git logic entirely. Phase 1 assumes the
	// agent host has its own git auth (SSH key or credential helper).
	GitRemoteURL string `json:"git_remote_url"`
	// IOSDistAppID: optional FK to iosdist_apps in same workspace.
	// When set, project is iOS-flavored: pickup body includes
	// bundle_id + xcodegen guidance, polar-agent submit-build uses
	// the bound app's cert / profile / ASC config to sign + upload
	// to TestFlight. nil = project isn't iOS-tied.
	IOSDistAppID *int64 `json:"iosdist_app_id,omitempty"`
	// DefaultLLMConfigID is the LLM the project was last decomposed
	// with. Sub-task chats and research dispatches use this ahead of
	// the workspace default. nil = project hasn't been decomposed yet
	// (or the referenced config was deleted).
	DefaultLLMConfigID *int64    `json:"default_llm_config_id,omitempty"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

type ProjectFeature struct {
	ID           string    `json:"id"`
	ProjectID    string    `json:"project_id"`
	Ord          int       `json:"ord"`
	Title        string    `json:"title"`
	Description  string    `json:"description"`
	Complexity   string    `json:"complexity"`
	Selected     bool      `json:"selected"`
	SprintNumber int       `json:"sprint_number"`
	CreatedAt    time.Time `json:"created_at"`
}

type ProjectTask struct {
	ID           string     `json:"id"`
	ProjectID    string     `json:"project_id"`
	FeatureID    *string    `json:"feature_id,omitempty"`
	Title        string     `json:"title"`
	Description  string     `json:"description"`
	Status       string     `json:"status"`
	BotUserID    *string    `json:"bot_user_id,omitempty"`
	ChatThreadID *int64     `json:"chat_thread_id,omitempty"`
	LLMThreadID  *int64     `json:"llm_thread_id,omitempty"`
	SprintNumber int        `json:"sprint_number"`
	Ord          int        `json:"ord"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
	StartedAt    *time.Time `json:"started_at,omitempty"`
	CompletedAt  *time.Time `json:"completed_at,omitempty"`
}

// ---- projects ------------------------------------------------------

func (p *Plugin) createProject(proj *Project) error {
	if proj == nil {
		return errors.New("project is nil")
	}
	if proj.ID == "" {
		proj.ID = generateResourceID()
	}
	if proj.Status == "" {
		proj.Status = ProjectStatusDraft
	}
	now := time.Now().UTC()
	proj.CreatedAt = now
	proj.UpdatedAt = now
	var iosAppArg any
	if proj.IOSDistAppID != nil && *proj.IOSDistAppID > 0 {
		iosAppArg = *proj.IOSDistAppID
	} else {
		iosAppArg = nil
	}
	_, err := p.DB.Exec(
		`INSERT INTO projects (id, workspace_id, creator_user_id, name, description, status, template, runtime_env, business_scenario, code_provider, current_sprint, git_remote_url, iosdist_app_id, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)`,
		proj.ID, proj.WorkspaceID, proj.CreatorUserID, proj.Name, proj.Description, proj.Status, proj.Template,
		proj.RuntimeEnv, proj.BusinessScenario, proj.CodeProvider, proj.CurrentSprint, proj.GitRemoteURL, iosAppArg, now,
	)
	return err
}

// projectSelectColumns is the canonical SELECT list for projects.
// Centralized so adding a column means touching one place.
const projectSelectColumns = `id, workspace_id, creator_user_id, name, description, status, template, runtime_env, business_scenario, code_provider, COALESCE(current_sprint, 0), COALESCE(git_remote_url, ''), iosdist_app_id, default_llm_config_id, created_at, updated_at`

func scanProject(scanFn func(...any) error) (*Project, error) {
	var proj Project
	var iosAppID sql.NullInt64
	var defaultLLMID sql.NullInt64
	if err := scanFn(&proj.ID, &proj.WorkspaceID, &proj.CreatorUserID, &proj.Name, &proj.Description, &proj.Status, &proj.Template, &proj.RuntimeEnv, &proj.BusinessScenario, &proj.CodeProvider, &proj.CurrentSprint, &proj.GitRemoteURL, &iosAppID, &defaultLLMID, &proj.CreatedAt, &proj.UpdatedAt); err != nil {
		return nil, err
	}
	if iosAppID.Valid {
		v := iosAppID.Int64
		proj.IOSDistAppID = &v
	}
	if defaultLLMID.Valid {
		v := defaultLLMID.Int64
		proj.DefaultLLMConfigID = &v
	}
	return &proj, nil
}

func (p *Plugin) listProjects(workspaceID string) ([]Project, error) {
	rows, err := p.DB.Query(
		`SELECT `+projectSelectColumns+`
		 FROM projects WHERE workspace_id = $1 ORDER BY updated_at DESC`,
		workspaceID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Project{}
	for rows.Next() {
		proj, err := scanProject(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, *proj)
	}
	return out, rows.Err()
}

func (p *Plugin) getProject(id, workspaceID string) (*Project, error) {
	row := p.DB.QueryRow(
		`SELECT `+projectSelectColumns+`
		 FROM projects WHERE id = $1 AND workspace_id = $2`,
		id, workspaceID,
	)
	proj, err := scanProject(row.Scan)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return proj, nil
}

// ProjectMetaUpdate carries the editable project fields, all
// optional. Nil pointers leave the existing value unchanged.
type ProjectMetaUpdate struct {
	Name             *string
	Description      *string
	Status           *string
	Template         *string
	RuntimeEnv       *string
	BusinessScenario *string
	CodeProvider     *string
	GitRemoteURL     *string
	// IOSDistAppID double-pointer: nil outer = no change; outer
	// non-nil with inner nil = unbind (set NULL); outer non-nil
	// with inner non-nil = set the FK value.
	IOSDistAppID **int64
	// DefaultLLMConfigID is the AI 拆解-time pick. Sub-task chats
	// fall back to this so a project planned with a specific model
	// keeps replying with the same one. nil = no change; non-nil
	// pointing to 0 = clear; non-nil >0 = set the FK.
	DefaultLLMConfigID *int64
}

func (p *Plugin) updateProjectMetadata(id, workspaceID string, u ProjectMetaUpdate) error {
	sets := []string{"updated_at = NOW()"}
	args := []any{}
	if u.Name != nil {
		args = append(args, *u.Name)
		sets = append(sets, "name = $"+itoa(len(args)))
	}
	if u.Description != nil {
		args = append(args, *u.Description)
		sets = append(sets, "description = $"+itoa(len(args)))
	}
	if u.Status != nil {
		args = append(args, *u.Status)
		sets = append(sets, "status = $"+itoa(len(args)))
	}
	if u.Template != nil {
		args = append(args, *u.Template)
		sets = append(sets, "template = $"+itoa(len(args)))
	}
	if u.RuntimeEnv != nil {
		args = append(args, *u.RuntimeEnv)
		sets = append(sets, "runtime_env = $"+itoa(len(args)))
	}
	if u.BusinessScenario != nil {
		args = append(args, *u.BusinessScenario)
		sets = append(sets, "business_scenario = $"+itoa(len(args)))
	}
	if u.CodeProvider != nil {
		args = append(args, *u.CodeProvider)
		sets = append(sets, "code_provider = $"+itoa(len(args)))
	}
	if u.GitRemoteURL != nil {
		args = append(args, *u.GitRemoteURL)
		sets = append(sets, "git_remote_url = $"+itoa(len(args)))
	}
	if u.IOSDistAppID != nil {
		// Double-pointer: outer non-nil signals "user wants to change
		// this column"; inner nil means clear the FK, inner non-nil
		// means set it.
		var v any
		if *u.IOSDistAppID != nil && **u.IOSDistAppID > 0 {
			v = **u.IOSDistAppID
		} else {
			v = nil
		}
		args = append(args, v)
		sets = append(sets, "iosdist_app_id = $"+itoa(len(args)))
	}
	if u.DefaultLLMConfigID != nil {
		var v any
		if *u.DefaultLLMConfigID > 0 {
			v = *u.DefaultLLMConfigID
		} else {
			v = nil
		}
		args = append(args, v)
		sets = append(sets, "default_llm_config_id = $"+itoa(len(args)))
	}
	if len(args) == 0 {
		return nil
	}
	args = append(args, id, workspaceID)
	query := "UPDATE projects SET " + strings.Join(sets, ", ") + " WHERE id = $" + itoa(len(args)-1) + " AND workspace_id = $" + itoa(len(args))
	res, err := p.DB.Exec(query, args...)
	if err != nil {
		return err
	}
	rows, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (p *Plugin) deleteProject(id, workspaceID string) error {
	_, err := p.DB.Exec(`DELETE FROM projects WHERE id = $1 AND workspace_id = $2`, id, workspaceID)
	return err
}

// ---- features ------------------------------------------------------

// appendProjectFeatures inserts a new sprint of features. It does
// NOT delete anything — old sprints stay queryable. Atomically
// bumps projects.current_sprint and tags the new rows with that
// sprint number, so the UI can group by sprint and the user can
// see how the project evolved.
//
// Returns the new sprint number so callers can include it in the
// response (FE highlights the just-added sprint).
func (p *Plugin) appendProjectFeatures(projectID string, features []ProjectFeature) (int, error) {
	tx, err := p.DB.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	var newSprint int
	if err := tx.QueryRow(
		`UPDATE projects SET current_sprint = COALESCE(current_sprint, 0) + 1, updated_at = NOW()
		 WHERE id = $1
		 RETURNING current_sprint`,
		projectID,
	).Scan(&newSprint); err != nil {
		return 0, err
	}

	// Find the highest existing ord for this project so the new
	// sprint's features sort after older ones. We reset ord per
	// sprint instead of globally; FE groups by sprint anyway.
	for i := range features {
		f := &features[i]
		if f.ID == "" {
			f.ID = generateResourceID()
		}
		f.ProjectID = projectID
		f.Ord = i
		f.SprintNumber = newSprint
		if f.Complexity == "" {
			f.Complexity = ProjectFeatureComplexityMedium
		}
		f.CreatedAt = time.Now().UTC()
		if _, err := tx.Exec(
			`INSERT INTO project_features (id, project_id, ord, title, description, complexity, selected, sprint_number, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			f.ID, projectID, f.Ord, f.Title, f.Description, f.Complexity, f.Selected, f.SprintNumber, f.CreatedAt,
		); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return newSprint, nil
}

// replaceProjectFeatures kept for backward compat / non-iterative
// flows. Wipes everything and inserts under sprint 1. Currently
// unused by the decompose endpoint (which uses appendProjectFeatures);
// kept as a primitive in case future flows want a "reset" path.
func (p *Plugin) replaceProjectFeatures(projectID string, features []ProjectFeature) error {
	tx, err := p.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM project_features WHERE project_id = $1`, projectID); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE projects SET current_sprint = 1, updated_at = NOW() WHERE id = $1`, projectID); err != nil {
		return err
	}
	for i := range features {
		f := &features[i]
		if f.ID == "" {
			f.ID = generateResourceID()
		}
		f.ProjectID = projectID
		f.Ord = i
		f.SprintNumber = 1
		if f.Complexity == "" {
			f.Complexity = ProjectFeatureComplexityMedium
		}
		f.CreatedAt = time.Now().UTC()
		if _, err := tx.Exec(
			`INSERT INTO project_features (id, project_id, ord, title, description, complexity, selected, sprint_number, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			f.ID, projectID, f.Ord, f.Title, f.Description, f.Complexity, f.Selected, f.SprintNumber, f.CreatedAt,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (p *Plugin) listProjectFeatures(projectID string) ([]ProjectFeature, error) {
	rows, err := p.DB.Query(
		`SELECT id, project_id, ord, title, description, complexity, selected, COALESCE(sprint_number, 1), created_at
		 FROM project_features WHERE project_id = $1
		 ORDER BY sprint_number ASC, ord ASC`,
		projectID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ProjectFeature{}
	for rows.Next() {
		var f ProjectFeature
		if err := rows.Scan(&f.ID, &f.ProjectID, &f.Ord, &f.Title, &f.Description, &f.Complexity, &f.Selected, &f.SprintNumber, &f.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (p *Plugin) updateProjectFeature(projectID, featureID, title, description, complexity string, selected bool) error {
	res, err := p.DB.Exec(
		`UPDATE project_features SET title = $1, description = $2, complexity = $3, selected = $4
		 WHERE id = $5 AND project_id = $6`,
		title, description, complexity, selected, featureID, projectID,
	)
	if err != nil {
		return err
	}
	rows, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// deleteProjectFeature removes a single feature row. Tasks derived
// from this feature survive — project_tasks.feature_id has
// ON DELETE SET NULL by design (features can be re-decomposed; tasks
// are the persistent execution record).
func (p *Plugin) deleteProjectFeature(projectID, featureID string) error {
	res, err := p.DB.Exec(
		`DELETE FROM project_features WHERE id = $1 AND project_id = $2`,
		featureID, projectID,
	)
	if err != nil {
		return err
	}
	rows, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// ---- tasks ---------------------------------------------------------

// generatePlanFromSelectedFeatures creates one task per selected
// feature that doesn't already have a task. Idempotent — calling
// twice doesn't duplicate. Tasks track the source feature_id so a
// re-decompose can leave the old tasks untouched.
func (p *Plugin) generatePlanFromSelectedFeatures(projectID string) ([]ProjectTask, error) {
	features, err := p.listProjectFeatures(projectID)
	if err != nil {
		return nil, err
	}
	tx, err := p.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	out := []ProjectTask{}
	for _, f := range features {
		if !f.Selected {
			continue
		}
		// Skip if a task already exists for this feature.
		var existing string
		err := tx.QueryRow(
			`SELECT id FROM project_tasks WHERE project_id = $1 AND feature_id = $2 LIMIT 1`,
			projectID, f.ID,
		).Scan(&existing)
		if err == nil && existing != "" {
			continue
		}
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		t := ProjectTask{
			ID:           generateResourceID(),
			ProjectID:    projectID,
			Title:        f.Title,
			Description:  f.Description,
			Status:       ProjectTaskStatusTodo,
			SprintNumber: f.SprintNumber,
			Ord:          f.Ord,
			CreatedAt:    time.Now().UTC(),
			UpdatedAt:    time.Now().UTC(),
		}
		fid := f.ID
		t.FeatureID = &fid
		if _, err := tx.Exec(
			`INSERT INTO project_tasks (id, project_id, feature_id, title, description, status, sprint_number, ord, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
			t.ID, t.ProjectID, t.FeatureID, t.Title, t.Description, t.Status, t.SprintNumber, t.Ord, t.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	if _, err := tx.Exec(
		`UPDATE projects SET status = $1, updated_at = $2 WHERE id = $3 AND status = $4`,
		ProjectStatusBuilding, time.Now().UTC(), projectID, ProjectStatusPlanning,
	); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}

// projectTaskSelectColumns + scanProjectTask centralize the
// scanning so list / single-row / load-by-id paths stay in sync.
const projectTaskSelectColumns = `id, project_id, feature_id, title, description, status, bot_user_id, chat_thread_id, llm_thread_id, COALESCE(sprint_number, 1), ord, created_at, updated_at, started_at, completed_at`

func scanProjectTask(scanFn func(...any) error) (*ProjectTask, error) {
	var t ProjectTask
	var featureID, botUserID sql.NullString
	var chatThreadID, llmThreadID sql.NullInt64
	var startedAt, completedAt sql.NullTime
	if err := scanFn(&t.ID, &t.ProjectID, &featureID, &t.Title, &t.Description, &t.Status, &botUserID, &chatThreadID, &llmThreadID, &t.SprintNumber, &t.Ord, &t.CreatedAt, &t.UpdatedAt, &startedAt, &completedAt); err != nil {
		return nil, err
	}
	if featureID.Valid {
		v := featureID.String
		t.FeatureID = &v
	}
	if botUserID.Valid {
		v := botUserID.String
		t.BotUserID = &v
	}
	if chatThreadID.Valid {
		v := chatThreadID.Int64
		t.ChatThreadID = &v
	}
	if llmThreadID.Valid {
		v := llmThreadID.Int64
		t.LLMThreadID = &v
	}
	if startedAt.Valid {
		v := startedAt.Time
		t.StartedAt = &v
	}
	if completedAt.Valid {
		v := completedAt.Time
		t.CompletedAt = &v
	}
	return &t, nil
}

func (p *Plugin) listProjectTasks(projectID string) ([]ProjectTask, error) {
	rows, err := p.DB.Query(
		`SELECT `+projectTaskSelectColumns+`
		 FROM project_tasks WHERE project_id = $1
		 ORDER BY sprint_number ASC, ord ASC, created_at ASC`,
		projectID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ProjectTask{}
	for rows.Next() {
		t, err := scanProjectTask(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

// loadProjectTask is the single-row variant of listProjectTasks.
// Used by pickup to fetch the task we're updating.
func (p *Plugin) loadProjectTask(projectID, taskID string) (*ProjectTask, error) {
	row := p.DB.QueryRow(
		`SELECT `+projectTaskSelectColumns+`
		 FROM project_tasks WHERE project_id = $1 AND id = $2`,
		projectID, taskID,
	)
	return scanProjectTask(row.Scan)
}

type ProjectTaskUpdate struct {
	Title       *string
	Description *string
	Status      *string
}

func (p *Plugin) updateProjectTask(projectID, taskID string, u ProjectTaskUpdate) error {
	sets := []string{"updated_at = NOW()"}
	args := []any{}
	if u.Title != nil {
		args = append(args, *u.Title)
		sets = append(sets, "title = $"+itoa(len(args)))
	}
	if u.Description != nil {
		args = append(args, *u.Description)
		sets = append(sets, "description = $"+itoa(len(args)))
	}
	if u.Status != nil {
		args = append(args, *u.Status)
		sets = append(sets, "status = $"+itoa(len(args)))
		// Track when in_progress / done occurs for timeline displays.
		switch *u.Status {
		case ProjectTaskStatusInProgress:
			sets = append(sets, "started_at = COALESCE(started_at, NOW())")
		case ProjectTaskStatusDone:
			sets = append(sets, "completed_at = NOW()")
		}
	}
	args = append(args, taskID, projectID)
	q := `UPDATE project_tasks SET ` + strings.Join(sets, ", ") +
		` WHERE id = $` + itoa(len(args)-1) + ` AND project_id = $` + itoa(len(args))
	res, err := p.DB.Exec(q, args...)
	if err != nil {
		return err
	}
	rows, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// taskRevisionAudit is the snapshot data fed into a revision row.
// Bundled so callers can pass it through update paths without a
// growing positional argument list.
type taskRevisionAudit struct {
	Title       string
	Description string
	Source      string
	LLMName     string
	LLMModel    string
	CreatedBy   string
}

// createProjectTaskRevision appends an audit row recording the
// pre-update task state. Verifies (taskID, projectID) actually pair
// up before inserting — defense against a caller that has the task
// id but never re-validated it belongs to the workspace's project.
// Returns sql.ErrNoRows if the pair doesn't exist.
//
// The transactional sibling updateProjectTaskWithAudit below is the
// preferred entrypoint when the audit row should land atomically
// with the corresponding update; this standalone version is here
// for completeness + tests.
func (p *Plugin) createProjectTaskRevision(projectID, taskID string, audit taskRevisionAudit) error {
	// Validate the task is actually in the claimed project. Without
	// this check, a caller with a stray taskID could write audit
	// rows pointing at unrelated tasks.
	var actualProjectID string
	err := p.DB.QueryRow(
		`SELECT project_id FROM project_tasks WHERE id = $1`,
		taskID,
	).Scan(&actualProjectID)
	if err != nil {
		return err
	}
	if actualProjectID != projectID {
		return sql.ErrNoRows
	}
	var createdByArg any
	if strings.TrimSpace(audit.CreatedBy) != "" {
		createdByArg = audit.CreatedBy
	} else {
		createdByArg = nil
	}
	_, err = p.DB.Exec(
		`INSERT INTO project_task_revisions (task_id, title, description, source, llm_name, llm_model, created_by, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
		taskID, audit.Title, audit.Description, audit.Source, audit.LLMName, audit.LLMModel, createdByArg,
	)
	return err
}

// updateProjectTaskWithAudit is the transactional sibling of
// updateProjectTask. When audit is non-nil, snapshots the pre-update
// task into project_task_revisions in the SAME transaction as the
// UPDATE. This closes the audit-loss race where a crash between
// audit-write and task-update would leave an orphan revision row,
// AND the inverse where a failed update would leave a duplicate
// revision after a frontend retry.
//
// Pass audit=nil when no audit is desired; behavior matches plain
// updateProjectTask.
func (p *Plugin) updateProjectTaskWithAudit(projectID, taskID string, u ProjectTaskUpdate, audit *taskRevisionAudit) error {
	tx, err := p.DB.Begin()
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	// Audit step: snapshot the existing task. Pulled inside the tx
	// so the title/description we capture are exactly the values
	// that the UPDATE replaces. SELECT FOR UPDATE locks the row
	// against concurrent edits.
	if audit != nil {
		var prevTitle, prevDescription, actualProjectID string
		err = tx.QueryRow(
			`SELECT project_id, title, description FROM project_tasks WHERE id = $1 FOR UPDATE`,
			taskID,
		).Scan(&actualProjectID, &prevTitle, &prevDescription)
		if err != nil {
			return err
		}
		if actualProjectID != projectID {
			err = sql.ErrNoRows
			return err
		}
		var createdByArg any
		if strings.TrimSpace(audit.CreatedBy) != "" {
			createdByArg = audit.CreatedBy
		} else {
			createdByArg = nil
		}
		_, err = tx.Exec(
			`INSERT INTO project_task_revisions (task_id, title, description, source, llm_name, llm_model, created_by, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
			taskID, prevTitle, prevDescription, audit.Source, audit.LLMName, audit.LLMModel, createdByArg,
		)
		if err != nil {
			return err
		}
	}

	// UPDATE step: same SQL build as updateProjectTask but inside
	// the tx. Kept inline here rather than calling the public
	// helper because that uses p.DB.Exec (different connection,
	// outside the tx).
	sets := []string{"updated_at = NOW()"}
	args := []any{}
	if u.Title != nil {
		args = append(args, *u.Title)
		sets = append(sets, "title = $"+itoa(len(args)))
	}
	if u.Description != nil {
		args = append(args, *u.Description)
		sets = append(sets, "description = $"+itoa(len(args)))
	}
	if u.Status != nil {
		args = append(args, *u.Status)
		sets = append(sets, "status = $"+itoa(len(args)))
		switch *u.Status {
		case ProjectTaskStatusInProgress:
			sets = append(sets, "started_at = COALESCE(started_at, NOW())")
		case ProjectTaskStatusDone:
			sets = append(sets, "completed_at = NOW()")
		}
	}
	args = append(args, taskID, projectID)
	q := `UPDATE project_tasks SET ` + strings.Join(sets, ", ") +
		` WHERE id = $` + itoa(len(args)-1) + ` AND project_id = $` + itoa(len(args))
	res, execErr := tx.Exec(q, args...)
	if execErr != nil {
		err = execErr
		return err
	}
	rows, raErr := res.RowsAffected()
	if raErr != nil {
		err = raErr
		return err
	}
	if rows == 0 {
		err = sql.ErrNoRows
		return err
	}
	if commitErr := tx.Commit(); commitErr != nil {
		err = commitErr
		return err
	}
	return nil
}

// bulkUpdateProjectTaskStatus updates every task in the project
// (optionally filtered by current status) to a single new
// status. started_at / completed_at are stamped when transitioning
// to in_progress / done so the per-task timestamps stay coherent
// with the per-task updateProjectTask path. Returns the number
// of rows affected so the FE can show "已取消 5 个任务" etc.
func (p *Plugin) bulkUpdateProjectTaskStatus(projectID, target string, fromStatuses []string) (int64, error) {
	args := []any{target, projectID}
	q := `UPDATE project_tasks
	         SET status = $1,
	             updated_at = NOW(),
	             started_at = CASE WHEN $1 = 'in_progress' THEN COALESCE(started_at, NOW()) ELSE started_at END,
	             completed_at = CASE WHEN $1 = 'done' THEN NOW() ELSE completed_at END
	       WHERE project_id = $2`
	if len(fromStatuses) > 0 {
		args = append(args, pq.Array(fromStatuses))
		q += ` AND status = ANY($3)`
	}
	res, err := p.DB.Exec(q, args...)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// itoa lives in video_store.go — reusing it here.
