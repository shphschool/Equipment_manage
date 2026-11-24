import { NextResponse } from "next/server";
import { addEquipment, listEquipment, updateEquipment, type EquipmentInput } from "@/lib/store";

/**
 * CSV 批量导入。body: { rows: ImportRow[], mode: "update" | "skip" | "add" }
 * 列名映射在浏览器端完成（见 lib/csv.ts），服务端只做落库。
 * 有「资产编号」时按编号去重；没有编号时退回按名称去重。
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const mode = ["update", "skip", "add"].includes(body.mode) ? body.mode : "update";
  if (rows.length === 0) return NextResponse.json({ error: "没有可导入的数据行" }, { status: 400 });

  const all = await listEquipment();
  const byNo = new Map(all.filter((e) => e.assetNo).map((e) => [e.assetNo.trim(), e]));
  const byName = new Map(all.map((e) => [e.name.trim(), e]));
  const addedKeys = new Set<string>();
  let added = 0, updated = 0, skipped = 0;
  const issues: string[] = [];

  for (const r of rows as (EquipmentInput & { srcLine?: number })[]) {
    const name = String(r.name ?? "").trim();
    if (!name) {
      if (r.srcLine) issues.push(`第 ${r.srcLine} 行缺少设备名称，已跳过`);
      else skipped++;
      continue;
    }
    const assetNo = String(r.assetNo ?? "").trim();
    const line = r.srcLine ? `第 ${r.srcLine} 行「${assetNo || name}」：` : `「${assetNo || name}」：`;
    const prev = assetNo ? byNo.get(assetNo) : byName.get(name);
    const key = assetNo || name;
    const clean: EquipmentInput = {
      assetNo,
      name,
      spec: r.spec,
      category: r.category,
      assetType: r.assetType,
      unit: r.unit,
      price: r.price,
      total: r.total,
      inUse: r.inUse,
      loaned: r.loaned,
      remark: r.remark,
    };

    if (mode === "add") {
      if (prev || addedKeys.has(key)) {
        skipped++;
        issues.push(`${line}与${prev ? "现有" : "本次文件内"}资产${assetNo ? "编号" : "名称"}重复，已跳过（如需更新请改用「更新同名」模式）`);
        continue;
      }
      const created = await addEquipment(clean);
      if (created.assetNo) byNo.set(created.assetNo, created);
      byName.set(created.name, created);
      addedKeys.add(key);
      added++;
    } else if (prev) {
      if (mode === "skip") {
        skipped++;
        issues.push(`${line}已存在，已跳过`);
        continue;
      }
      const next = await updateEquipment(prev.id, clean);
      if (next) {
        if (next.assetNo) byNo.set(next.assetNo, next);
        byName.set(next.name, next);
      }
      updated++;
    } else {
      const created = await addEquipment(clean);
      if (created.assetNo) byNo.set(created.assetNo, created);
      byName.set(created.name, created);
      addedKeys.add(key);
      added++;
    }
  }

  return NextResponse.json({
    ok: true,
    added,
    updated,
    skipped,
    mode,
    issues: issues.slice(0, 8),
  });
}
