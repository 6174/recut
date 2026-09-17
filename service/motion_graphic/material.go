/*
 * [INPUT]: 依赖平台 workspace.sqlite（由调用方传入 *sql.DB）。
 * [OUTPUT]: Motion Graphic（MG）全局素材的存储契约：单条 current code（无版本历史）、
 *           code_version/versionId、last-good 保护、全局列表；不持有任何项目概念。
 * [POS]: motion_graphic 包的持久化层；MG 是平台级通用素材，项目引用由消费方自行维护。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package motion_graphic

import (
	"database/sql"
	"encoding/json"
	"strconv"
	"time"
)

// Material 是全局 Motion Graphic 素材的当前 code 记录。#2：不支持多版本——调整覆盖
// current code，要保留旧版就新建素材；构建失败永不覆盖 source/bundle（last-good）。
type Material struct {
	ID              string
	Name            string
	Surface         string
	KeywordsJSON    string
	Mode            string
	Source          string
	Bundle          string
	BundleHash      string
	InputsJSON      string
	Status          string
	CodeVersion     int64
	TestReportJSON  string
	LastErrorJSON   string
	CoverRef        string
	OriginAppID     string
	OriginProjectID string
	ArchivedAt      string
	CreatedAt       string
	UpdatedAt       string
}

const schema = `
create table if not exists mg_materials (
  material_id text primary key, name text not null, surface text not null default 'r3f',
  keywords_json text not null default '[]', mode text not null default 'local',
  source text not null default '', bundle text not null default '', bundle_hash text not null default '',
  inputs_json text not null default '[]', status text not null default 'draft',
  code_version integer not null default 0, test_report_json text, last_error_json text,
  cover_ref text not null default '', origin_app_id text not null default '',
  origin_project_id text not null default '', archived_at text,
  created_at text not null, updated_at text not null
);
create index if not exists mg_materials_updated on mg_materials(updated_at desc);
`

// EnsureSchema creates the global MG material table (idempotent).
func EnsureSchema(db *sql.DB) error {
	_, err := db.Exec(schema)
	return err
}

func nowISO() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }

// VersionID 是当前 code 的稳定句柄：<materialId>@<codeVersion>。
func VersionID(id string, codeVersion int64) string {
	return id + "@" + strconv.FormatInt(codeVersion, 10)
}

func (m Material) VersionID() string { return VersionID(m.ID, m.CodeVersion) }

func (m Material) Keywords() []any { return decodeArray(m.KeywordsJSON) }
func (m Material) Inputs() []any   { return decodeArray(m.InputsJSON) }

func decodeArray(text string) []any {
	out := []any{}
	if text == "" {
		return out
	}
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		return []any{}
	}
	return out
}

func readRow(row map[string]any) Material {
	return Material{
		ID:              str(row["material_id"]),
		Name:            str(row["name"]),
		Surface:         str(row["surface"]),
		KeywordsJSON:    fallback(str(row["keywords_json"]), "[]"),
		Mode:            fallback(str(row["mode"]), "local"),
		Source:          str(row["source"]),
		Bundle:          str(row["bundle"]),
		BundleHash:      str(row["bundle_hash"]),
		InputsJSON:      fallback(str(row["inputs_json"]), "[]"),
		Status:          fallback(str(row["status"]), "draft"),
		CodeVersion:     int64(number(row["code_version"])),
		TestReportJSON:  str(row["test_report_json"]),
		LastErrorJSON:   str(row["last_error_json"]),
		CoverRef:        str(row["cover_ref"]),
		OriginAppID:     str(row["origin_app_id"]),
		OriginProjectID: str(row["origin_project_id"]),
		ArchivedAt:      str(row["archived_at"]),
		CreatedAt:       str(row["created_at"]),
		UpdatedAt:       str(row["updated_at"]),
	}
}

func queryMaps(db *sql.DB, query string, args ...any) ([]map[string]any, error) {
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for rows.Next() {
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return nil, err
		}
		row := map[string]any{}
		for i, column := range columns {
			if b, ok := values[i].([]byte); ok {
				row[column] = string(b)
			} else {
				row[column] = values[i]
			}
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// Read loads one material by id.
func Read(db *sql.DB, id string) (Material, bool) {
	rows, err := queryMaps(db, "select * from mg_materials where material_id = ?", id)
	if err != nil || len(rows) == 0 {
		return Material{}, false
	}
	return readRow(rows[0]), true
}

// InsertDraft writes/overwrites the current code after a successful build.
// Callers must not call it on build failure (last-good protection).
func InsertDraft(db *sql.DB, m Material) error {
	now := nowISO()
	if m.CreatedAt == "" {
		m.CreatedAt = now
	}
	_, err := db.Exec("insert into mg_materials "+
		"(material_id, name, surface, keywords_json, mode, source, bundle, bundle_hash, inputs_json, status, code_version, test_report_json, last_error_json, cover_ref, origin_app_id, origin_project_id, archived_at, created_at, updated_at) "+
		"values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, '', '', ?, ?, null, ?, ?) "+
		"on conflict(material_id) do update set "+
		"name = excluded.name, surface = excluded.surface, keywords_json = excluded.keywords_json, mode = excluded.mode, "+
		"source = excluded.source, bundle = excluded.bundle, bundle_hash = excluded.bundle_hash, inputs_json = excluded.inputs_json, "+
		"status = excluded.status, code_version = excluded.code_version, last_error_json = '', updated_at = excluded.updated_at",
		m.ID, m.Name, m.Surface, m.KeywordsJSON, m.Mode, m.Source, m.Bundle, m.BundleHash, m.InputsJSON, m.Status, m.CodeVersion,
		m.OriginAppID, m.OriginProjectID, m.CreatedAt, now)
	return err
}

// RecordError stores a build failure diagnostic. It never overwrites an
// existing source/bundle; a brand-new failed attempt is inserted for context.
func RecordError(db *sql.DB, m Material) error {
	now := nowISO()
	if existing, ok := Read(db, m.ID); ok && existing.Source != "" {
		_, err := db.Exec("update mg_materials set last_error_json = ?, updated_at = ? where material_id = ?",
			fallback(m.LastErrorJSON, "{}"), now, m.ID)
		return err
	}
	if m.CreatedAt == "" {
		m.CreatedAt = now
	}
	status := fallback(m.Status, "failed")
	_, err := db.Exec("insert into mg_materials "+
		"(material_id, name, surface, keywords_json, mode, source, bundle, bundle_hash, inputs_json, status, code_version, test_report_json, last_error_json, cover_ref, origin_app_id, origin_project_id, archived_at, created_at, updated_at) "+
		"values (?, ?, ?, ?, ?, '', '', '', ?, ?, ?, null, ?, '', ?, ?, null, ?, ?) "+
		"on conflict(material_id) do update set last_error_json = excluded.last_error_json, updated_at = excluded.updated_at",
		m.ID, m.Name, m.Surface, m.KeywordsJSON, m.Mode, m.InputsJSON, status, m.CodeVersion,
		fallback(m.LastErrorJSON, "{}"), m.OriginAppID, m.OriginProjectID, m.CreatedAt, now)
	return err
}

func SetVerified(db *sql.DB, id, reportJSON, coverRef string) error {
	_, err := db.Exec("update mg_materials set status = 'verified', test_report_json = ?, cover_ref = ?, updated_at = ? where material_id = ?",
		reportJSON, coverRef, nowISO(), id)
	return err
}

func SetMode(db *sql.DB, id, mode string) error {
	_, err := db.Exec("update mg_materials set mode = ?, updated_at = ? where material_id = ?", mode, nowISO(), id)
	return err
}

func Archive(db *sql.DB, id string) error {
	now := nowISO()
	_, err := db.Exec("update mg_materials set archived_at = ?, updated_at = ? where material_id = ?", now, now, id)
	return err
}

// ListAll returns every non-archived material (the global MG library).
func ListAll(db *sql.DB) []Material {
	rows, err := queryMaps(db, "select * from mg_materials where (archived_at is null or archived_at = '') order by updated_at desc")
	if err != nil {
		return []Material{}
	}
	out := make([]Material, 0, len(rows))
	for _, row := range rows {
		out = append(out, readRow(row))
	}
	return out
}

// ListByIDs returns the requested materials in the given order (missing skipped).
func ListByIDs(db *sql.DB, ids []string) []Material {
	out := make([]Material, 0, len(ids))
	for _, id := range ids {
		if material, ok := Read(db, id); ok {
			out = append(out, material)
		}
	}
	return out
}
