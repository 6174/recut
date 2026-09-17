#!/usr/bin/env node
/**
 * 内存 sqlite mock —— 覆盖 background.js 用到的语句模板（INSERT..ON CONFLICT..WHERE、
 * UPDATE/DELETE/SELECT + coalesce(max(..))）。仅供 L0 测试使用。
 * 与 background.js 的 SQL 模板强耦合；改 SQL 时同步维护。
 *
 * [INPUT]: 接收 background 模块经 ctx.sqlite 发出的受限 SQL 与绑定参数。
 * [OUTPUT]: 对外提供 makeDb，返回最小 execute/query SQLite 行为模拟。
 * [POS]: scripts 的 L0 后台测试基础设施；只模拟实际已声明的 SQL 子集。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 *
 * 关键语义：`?` 占位符对语句内所有行一次性绑定，绝不在每行求值时重复消费。
 */
function makeDb() {
  const tables = {};
  const ensure = (name, createSql) => {
    if (!tables[name]) {
      const cols = [];
      const m = createSql.match(/\(\s*([\s\S]*?)\s*\)\s*$/);
      if (m) {
        for (const line of m[1].split(",")) {
          const c = line.trim().match(/^(\w+)\s/);
          if (c) cols.push(c[1]);
        }
      }
      tables[name] = { cols, rows: [] };
    }
  };
  const parseInsert = (sql) => {
    const m = sql.match(/insert into (\w+)\s*\(\s*([\s\S]*?)\s*\)\s*values\s*\(\s*([\s\S]*?)\s*\)/i);
    if (!m) return null;
    return { table: m[1], cols: m[2].split(",").map((c) => c.trim()), vals: m[3].split(",").map((v) => v.trim().replace(/^'|'$/g, "")) };
  };
  // 解析 where 条件（and 链）并一次性绑定 `?`
  const bindWhere = (sql, params, stopWords) => {
    const re = new RegExp("where\\s+([\\s\\S]*?)(?:" + stopWords + "|$)", "i");
    const whereM = sql.match(re);
    if (!whereM) return [];
    return whereM[1]
      .split("and")
      .map((c) => c.trim())
      .map((c) => {
        const m = c.match(/^(?:(?:\w+)\.)?(\w+)\s*(>=|<=|=|>|<)\s*(\?|'[^']*'|[\d.e-]+)$/i);
        if (!m) return null;
        return { key: m[1], op: m[2], val: m[3] === "?" ? params.shift() : m[3].replace(/^'|'$/g, "") };
      })
      .filter(Boolean);
  };
  const matches = (row, binds) => binds.every((b) => {
    if (b.op === "=") return String(row[b.key]) === String(b.val);
    const left = Number(row[b.key]);
    const right = Number(b.val);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (b.op === ">") return left > right;
    if (b.op === ">=") return left >= right;
    if (b.op === "<") return left < right;
    return left <= right;
  });

  return {
    tables,
    execute(sql, params) {
      params = params || [];
      if (/create table if not exists (\w+)/i.test(sql)) {
        const t = sql.match(/create table if not exists (\w+)/i)[1];
        ensure(t, sql);
        return { rowsAffected: 1 };
      }
      const ins = parseInsert(sql);
      if (ins) {
        const t = tables[ins.table];
        if (!t) throw new Error("no table " + ins.table);
        const conflict = /on conflict/i.test(sql);
        const values = ins.vals.map((v) => (v === "?" ? (params.length ? params.shift() : null) : v));
        if (conflict) {
          const pkValue = values[0];
          const row = t.rows.find((r) => r[t.cols[0]] === pkValue);
          const wm = sql.match(/where\s+editor_projects\.version\s*=\s*(\?|[\d]+)/i);
          let allowed = true;
          if (row && wm) {
            const want = wm[1] === "?" ? params.shift() : Number(wm[1]);
            allowed = Number(row.version) === Number(want);
          }
          if (!allowed) return { rowsAffected: 0 };
          if (row) {
            for (let i = 0; i < ins.cols.length; i++) row[ins.cols[i]] = values[i];
          } else {
            const o = {};
            for (let i = 0; i < ins.cols.length; i++) o[ins.cols[i]] = values[i];
            t.rows.push(o);
          }
          return { rowsAffected: 1 };
        }
        const o = {};
        for (let i = 0; i < ins.cols.length; i++) o[ins.cols[i]] = values[i];
        t.rows.push(o);
        return { rowsAffected: 1 };
      }
      if (/^update (\w+)/i.test(sql)) {
        const t = sql.match(/^update (\w+)/i)[1];
        const table = tables[t];
        if (!table) return { rowsAffected: 0 };
        const setM = sql.match(/set\s+([\s\S]*?)(?:where|$)/i);
        const sets = setM[1]
          .split(",")
          .map((s) => {
            const sm = s.match(/(\w+)\s*=\s*(\?|'[^']*'|[\d.e-]+)/i);
            if (!sm) return null;
            return { key: sm[1], val: sm[2] === "?" ? params.shift() : sm[2].replace(/^'|'$/g, "") };
          })
          .filter(Boolean);
        const binds = bindWhere(sql, params, "order\\s+by|limit");
        let affected = 0;
        for (const row of table.rows) {
          if (matches(row, binds)) {
            for (const s of sets) row[s.key] = s.val;
            affected += 1;
          }
        }
        return { rowsAffected: affected };
      }
      if (/^delete from (\w+)/i.test(sql)) {
        const t = sql.match(/^delete from (\w+)/i)[1];
        const table = tables[t];
        if (!table) return { rowsAffected: 0 };
        const binds = bindWhere(sql, params, "order\\s+by|limit");
        const before = table.rows.length;
        table.rows = table.rows.filter((row) => !matches(row, binds));
        return { rowsAffected: before - table.rows.length };
      }
      throw new Error("mock execute unsupported: " + sql.slice(0, 80));
    },
    query(sql, params) {
      params = params || [];
      const m = sql.match(/select\s+([\s\S]*?)\s+from\s+(\w+)/i);
      if (!m) throw new Error("mock query unsupported: " + sql.slice(0, 80));
      const table = tables[m[2]];
      const binds = bindWhere(sql, params, "order\\s+by|limit");
      let rows = (table ? table.rows : []).filter((row) => matches(row, binds));
      const orderM = sql.match(/order by\s+(\w+)(\s+(asc|desc))?/i);
      if (orderM) {
        const dir = (orderM[3] || "asc").toLowerCase();
        rows = rows.slice().sort((a, b) =>
          dir === "desc" ? String(b[orderM[1]]).localeCompare(String(a[orderM[1]])) : String(a[orderM[1]]).localeCompare(String(b[orderM[1]])),
        );
      }
      const limitM = sql.match(/limit\s+(\d+)/i);
      if (limitM) rows = rows.slice(0, Number(limitM[1]));
      const agg = sql.match(/coalesce\(max\((\w+)\),\s*([\d]+)\)\s+as\s+(\w+)/i);
      if (agg) {
        let maxV = 0;
        for (const r of rows) if (Number(r[agg[1]]) > maxV) maxV = Number(r[agg[1]]);
        return [{ [agg[3]]: maxV }];
      }
      return rows;
    },
  };
}

module.exports = { makeDb };
