/**
 * [INPUT]: 依赖 project-store 的 SQLite schema、组件表与 ctx.files URL 能力。
 * [OUTPUT]: 提供项目 asset 引用索引；当前登记 component 类型，保留未来 media/reference 类型的统一入口。
 * [POS]: background 的项目素材索引边界；不拥有组件源码，只保存稳定引用与展示投影。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

function projectAssetId(type, refId) {
  return type + ":" + refId;
}

function ensureAssetSchema(ctx, scopeId) {
  ensureSchema(ctx, scopeId);
  ctx.sqlite.execute(
    "create table if not exists editor_assets (" +
      "asset_id text not null primary key, " +
      "project_id text not null, " +
      "type text not null, " +
      "ref_id text not null, " +
      "ref_version_id text, " +
      "status text not null default 'active', " +
      "created_at text not null, " +
      "updated_at text not null, " +
      "unique (project_id, type, ref_id))",
    [scopeId],
  );
}

function upsertProjectAsset(ctx, input) {
  var scopeId = scope(ctx);
  var type = input && input.type;
  var refId = input && input.refId;
  if (!type || !refId) throw new Error("asset.upsert: type and refId are required");
  ensureAssetSchema(ctx, scopeId);
  var now = nowIso();
  var assetId = projectAssetId(type, refId);
  ctx.sqlite.execute(
    "insert into editor_assets (asset_id, project_id, type, ref_id, ref_version_id, status, created_at, updated_at) values (?, ?, ?, ?, ?, 'active', ?, ?) " +
      "on conflict(asset_id) do update set ref_version_id = excluded.ref_version_id, status = editor_assets.status, updated_at = excluded.updated_at",
    [assetId, scopeId, type, refId, input.refVersionId || null, now, now],
  );
  return assetId;
}

function archiveProjectAsset(ctx, type, refId) {
  var scopeId = scope(ctx);
  ensureAssetSchema(ctx, scopeId);
  var now = nowIso();
  ctx.sqlite.execute(
    "update editor_assets set status = 'archived', updated_at = ? where project_id = ? and type = ? and ref_id = ?",
    [now, scopeId, type, refId],
  );
}

function backfillComponentAssets(ctx, scopeId) {
  ensureAssetSchema(ctx, scopeId);
  var rows = ctx.sqlite.query(
    "select c.component_id, c.head_version_id " +
      "from editor_components c " +
      "join editor_component_versions v on v.version_id = c.head_version_id " +
      "left join editor_assets a on a.project_id = c.project_id and a.type = 'component' and a.ref_id = c.component_id " +
      "where c.project_id = ? and (c.archived_at is null or c.archived_at = '') and v.status = 'verified' and a.asset_id is null",
    [scopeId],
  );
  for (var i = 0; i < (rows || []).length; i++) {
    upsertProjectAsset(ctx, {
      type: "component",
      refId: rows[i].component_id,
      refVersionId: rows[i].head_version_id,
    });
  }
}

function listProjectAssets(ctx, scopeId) {
  backfillComponentAssets(ctx, scopeId);
  var rows = ctx.sqlite.query(
    "select a.asset_id, a.type, a.ref_id, a.ref_version_id, a.status, a.created_at, a.updated_at, " +
      "c.name, c.surface, c.keywords_json, c.mode, " +
      "v.version, v.status as version_status, v.inputs_json, v.test_report_json, v.cover_path " +
      "from editor_assets a " +
      "left join editor_components c on c.component_id = a.ref_id and c.project_id = a.project_id " +
      "left join editor_component_versions v on v.version_id = coalesce(a.ref_version_id, c.head_version_id) " +
      "where a.project_id = ? and a.status = 'active' order by a.updated_at desc",
    [scopeId],
  );
  return (rows || []).map(function (row) {
    var asset = {
      assetId: row.asset_id,
      type: row.type,
      refId: row.ref_id,
      refVersionId: row.ref_version_id || null,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    if (row.type === "component") {
      asset.componentId = row.ref_id;
      asset.versionId = row.ref_version_id || null;
      asset.name = row.name || row.ref_id;
      asset.surface = row.surface || "r3f";
      asset.mode = row.mode || "local";
      asset.keywords = parseJson(row.keywords_json, []);
      asset.version = row.version || null;
      asset.componentStatus = row.version_status || "draft";
      asset.inputs = parseJson(row.inputs_json, []);
      asset.testReport = parseJson(row.test_report_json, null);
      asset.coverUrl = row.cover_path ? ctx.files.url(row.cover_path) : null;
    }
    return asset;
  });
}

recut.operation.register("asset.list", (input, ctx) => {
  return { assets: listProjectAssets(ctx, scope(ctx)) };
});

recut.operation.register("asset.archive", (input, ctx) => {
  var type = input && input.type;
  var refId = input && input.refId;
  if (!type || !refId) throw new Error("asset.archive: type and refId are required");
  archiveProjectAsset(ctx, type, refId);
  if (type === "component") {
    emitProjectEvent(ctx, scope(ctx), "project.components.changed", {
      componentId: refId,
      status: "archived",
      asset: true,
    });
  }
  return { ok: true, assetId: projectAssetId(type, refId), status: "archived" };
});
