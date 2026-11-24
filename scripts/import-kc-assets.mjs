// 将 scripts/kc-assets.json（由科创教室.xlsx 生成）导入 Neon Postgres。
// 用法：node --env-file=.env.local scripts/import-kc-assets.mjs
// 特性：按资产编号幂等 upsert；低值物资已逐件展开并分配编号。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "@vercel/postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(__dirname, "kc-assets.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
const assets = manifest.assets ?? [];

if (!process.env.POSTGRES_URL) {
  console.error("缺少 POSTGRES_URL，请使用 --env-file=.env.local 运行");
  process.exit(1);
}

const slug = (assetNo) =>
  "kc-" + assetNo.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

await sql.query(`ALTER TABLE equipment ADD COLUMN IF NOT EXISTS asset_no TEXT NOT NULL DEFAULT ''`);
await sql.query(`ALTER TABLE equipment ADD COLUMN IF NOT EXISTS spec TEXT NOT NULL DEFAULT ''`);
await sql.query(`ALTER TABLE equipment ADD COLUMN IF NOT EXISTS asset_type TEXT NOT NULL DEFAULT 'fixed'`);
await sql.query(`ALTER TABLE equipment ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT '件'`);
await sql.query(`ALTER TABLE equipment ADD COLUMN IF NOT EXISTS price NUMERIC(12,2) NOT NULL DEFAULT 0`);
await sql.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_asset_no ON equipment (asset_no) WHERE asset_no <> ''`);

let inserted = 0;
let updated = 0;
const issues = [];

for (const a of assets) {
  const assetNo = String(a.assetNo ?? "").trim();
  const name = String(a.name ?? "").trim();
  if (!assetNo || !name) {
    issues.push(`跳过缺少编号或名称的行：${JSON.stringify(a)}`);
    continue;
  }
  const id = slug(assetNo);
  const type = a.assetType === "low" ? "low" : "fixed";

  const { rows } = await sql.query(`SELECT id FROM equipment WHERE asset_no = $1 LIMIT 1`, [assetNo]);
  if (rows[0]) {
    await sql`
      UPDATE equipment SET
        name = ${name}, spec = ${String(a.spec ?? "")}, category = ${String(a.category ?? "未分类")},
        asset_type = ${type}, unit = ${String(a.unit ?? "件")}, price = ${Number(a.price ?? 0)},
        remark = ${String(a.remark ?? "")}, updated_at = now()
      WHERE id = ${rows[0].id}`;
    updated++;
  } else {
    await sql`
      INSERT INTO equipment (
        id, asset_no, name, spec, category, asset_type, unit, price,
        total, in_use, loaned, remark, created_at, updated_at
      ) VALUES (
        ${id}, ${assetNo}, ${name}, ${String(a.spec ?? "")}, ${String(a.category ?? "未分类")},
        ${type}, ${String(a.unit ?? "件")}, ${Number(a.price ?? 0)},
        1, 0, 0, ${String(a.remark ?? "")}, now(), now()
      )`;
    inserted++;
  }
}

const summary = await sql.query(
  `SELECT asset_type, count(*)::int AS kinds, sum(total)::int AS total
   FROM equipment GROUP BY asset_type ORDER BY asset_type`
);
const totalRow = await sql.query(`SELECT count(*)::int AS rows, sum(total)::int AS total FROM equipment`);

console.log(`导入完成：新增 ${inserted}，更新 ${updated}，跳过 ${issues.length}`);
console.log("按类型汇总：", summary.rows);
console.log("台账合计：", totalRow.rows[0]);
if (issues.length) console.log("问题：", issues);
process.exit(0);
