// ============================================================
// 数据层：
//   - 部署到 Vercel（存在 POSTGRES_URL 环境变量）→ 使用 Vercel Postgres，
//     首次请求自动建表，无需手动执行 SQL。
//   - 本地开发（无 POSTGRES_URL）→ 回退到本地 JSON 文件（.data/db.json）。
// 上层 API 路由只调用本文件导出的异步函数，无需关心底层实现。
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { sql } from "@vercel/postgres";
import type { BorrowRecord, Equipment, PrintOrder } from "./types";
import { nowISO, uid } from "./types";

const usePg = !!process.env.POSTGRES_URL;

// ============================================================
// Postgres 实现（Vercel）
// ============================================================

let schemaReady: Promise<unknown> | null = null;

/** 首次请求自动建表（每个无服务器实例只执行一次） */
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = sql`
      CREATE TABLE IF NOT EXISTS equipment (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        category    TEXT NOT NULL DEFAULT '未分类',
        total       INTEGER NOT NULL DEFAULT 0,
        in_use      INTEGER NOT NULL DEFAULT 0,
        loaned      INTEGER NOT NULL DEFAULT 0,
        remark      TEXT NOT NULL DEFAULT '',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
      .then(() => sql`
        CREATE TABLE IF NOT EXISTS borrows (
          id             TEXT PRIMARY KEY,
          student        TEXT NOT NULL,
          class_name     TEXT NOT NULL,
          equipment_id   TEXT NOT NULL,
          equipment_name TEXT NOT NULL,
          quantity       INTEGER NOT NULL DEFAULT 1,
          reason         TEXT NOT NULL DEFAULT '',
          apply_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
          approve_at     TIMESTAMPTZ,
          returned_at    TIMESTAMPTZ,
          reject_reason  TEXT NOT NULL DEFAULT '',
          status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','returned','rejected'))
        )`)
      .then(() => sql`
        CREATE TABLE IF NOT EXISTS print_orders (
          id            TEXT PRIMARY KEY,
          student       TEXT NOT NULL,
          class_name    TEXT NOT NULL,
          phone         TEXT NOT NULL DEFAULT '',
          content       TEXT NOT NULL,
          quantity      INTEGER NOT NULL DEFAULT 1,
          material      TEXT NOT NULL DEFAULT 'PLA',
          note          TEXT NOT NULL DEFAULT '',
          status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','printing','done','delivered','rejected')),
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
          start_at      TIMESTAMPTZ,
          finish_at     TIMESTAMPTZ,
          deliver_at    TIMESTAMPTZ,
          reject_reason TEXT NOT NULL DEFAULT ''
        )`);
  }
  return schemaReady;
}

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : String(v ?? "");

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToEq(r: any): Equipment {
  return {
    id: r.id, name: r.name, category: r.category,
    total: r.total, inUse: r.in_use, loaned: r.loaned,
    remark: r.remark ?? "",
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  };
}

function rowToBorrow(r: any): BorrowRecord {
  return {
    id: r.id, student: r.student, className: r.class_name,
    equipmentId: r.equipment_id, equipmentName: r.equipment_name,
    quantity: r.quantity, reason: r.reason ?? "",
    applyAt: iso(r.apply_at),
    approveAt: r.approve_at ? iso(r.approve_at) : undefined,
    returnedAt: r.returned_at ? iso(r.returned_at) : undefined,
    rejectReason: r.reject_reason || undefined,
    status: r.status,
  };
}

function rowToPrint(r: any): PrintOrder {
  return {
    id: r.id, student: r.student, className: r.class_name,
    phone: r.phone || undefined,
    content: r.content, quantity: r.quantity, material: r.material,
    note: r.note || undefined,
    status: r.status, createdAt: iso(r.created_at),
    startAt: r.start_at ? iso(r.start_at) : undefined,
    finishAt: r.finish_at ? iso(r.finish_at) : undefined,
    deliverAt: r.deliver_at ? iso(r.deliver_at) : undefined,
    rejectReason: r.reject_reason || undefined,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function pgListEquipment(): Promise<Equipment[]> {
  await ensureSchema();
  const { rows } = await sql`SELECT * FROM equipment`;
  return rows.map(rowToEq).sort((a, b) => a.name.localeCompare(b.name, "zh"));
}

async function pgGetEquipment(id: string): Promise<Equipment | undefined> {
  await ensureSchema();
  const { rows } = await sql`SELECT * FROM equipment WHERE id = ${id} LIMIT 1`;
  return rows[0] ? rowToEq(rows[0]) : undefined;
}

export interface EquipmentInput {
  name: string;
  category?: string;
  total?: number;
  inUse?: number;
  loaned?: number;
  remark?: string;
}

/** 部分字段合并 + 一致性钳制（inUse+loaned<=total），两种实现共用 */
function mergeEq(existing: Equipment, input: EquipmentInput): Equipment {
  const total = input.total !== undefined ? Math.max(0, Math.floor(input.total)) : existing.total;
  let inUse = input.inUse !== undefined ? Math.max(0, Math.floor(input.inUse)) : existing.inUse;
  let loaned = input.loaned !== undefined ? Math.max(0, Math.floor(input.loaned)) : existing.loaned;
  inUse = Math.min(inUse, total);
  loaned = Math.min(loaned, Math.max(0, total - inUse));
  return {
    ...existing,
    name: (input.name ?? existing.name).trim(),
    category: (input.category ?? existing.category).trim() || "未分类",
    total,
    inUse,
    loaned,
    remark: (input.remark ?? existing.remark).trim(),
    updatedAt: nowISO(),
  };
}

async function pgUpsertEq(eq: Equipment): Promise<void> {
  await sql`
    UPDATE equipment SET name = ${eq.name}, category = ${eq.category}, total = ${eq.total},
      in_use = ${eq.inUse}, loaned = ${eq.loaned}, remark = ${eq.remark}, updated_at = ${eq.updatedAt}
    WHERE id = ${eq.id}`;
}

async function pgAddEquipment(input: EquipmentInput): Promise<Equipment> {
  await ensureSchema();
  const eq = mergeEq(
    { id: uid(), name: "", category: "未分类", total: 0, inUse: 0, loaned: 0, remark: "", createdAt: nowISO(), updatedAt: nowISO() },
    input
  );
  await sql`
    INSERT INTO equipment (id, name, category, total, in_use, loaned, remark, created_at, updated_at)
    VALUES (${eq.id}, ${eq.name}, ${eq.category}, ${eq.total}, ${eq.inUse}, ${eq.loaned}, ${eq.remark}, ${eq.createdAt}, ${eq.updatedAt})`;
  return eq;
}

async function pgUpdateEquipment(id: string, input: EquipmentInput): Promise<Equipment | null> {
  const existing = await pgGetEquipment(id);
  if (!existing) return null;
  const eq = mergeEq(existing, input);
  await pgUpsertEq(eq);
  return eq;
}

async function pgDeleteEquipment(id: string): Promise<{ ok: boolean; reason?: string }> {
  await ensureSchema();
  const { rows } = await sql`SELECT id FROM equipment WHERE id = ${id} LIMIT 1`;
  if (!rows[0]) return { ok: false, reason: "设备不存在" };
  const active = await sql`SELECT id FROM borrows WHERE equipment_id = ${id} AND status = 'approved' LIMIT 1`;
  if (active.rows[0]) return { ok: false, reason: "该设备存在未归还的借出记录，请先全部归还" };
  await sql`DELETE FROM equipment WHERE id = ${id}`;
  return { ok: true };
}

export interface BorrowInput {
  student: string;
  className: string;
  equipmentId: string;
  quantity: number;
  reason?: string;
}

async function pgListBorrows(): Promise<BorrowRecord[]> {
  await ensureSchema();
  const { rows } = await sql`SELECT * FROM borrows ORDER BY apply_at DESC`;
  return rows.map(rowToBorrow);
}

async function pgGetBorrow(id: string): Promise<BorrowRecord | undefined> {
  await ensureSchema();
  const { rows } = await sql`SELECT * FROM borrows WHERE id = ${id} LIMIT 1`;
  return rows[0] ? rowToBorrow(rows[0]) : undefined;
}

async function pgAddBorrow(input: BorrowInput): Promise<{ ok: boolean; borrow?: BorrowRecord; error?: string }> {
  const eq = await pgGetEquipment(input.equipmentId);
  if (!eq) return { ok: false, error: "所选设备不存在" };
  const b: BorrowRecord = {
    id: uid(),
    student: input.student.trim(),
    className: input.className.trim(),
    equipmentId: eq.id,
    equipmentName: eq.name,
    quantity: Math.max(1, Math.floor(input.quantity)),
    reason: (input.reason ?? "").trim(),
    applyAt: nowISO(),
    status: "pending",
  };
  await sql`
    INSERT INTO borrows (id, student, class_name, equipment_id, equipment_name, quantity, reason, apply_at, status)
    VALUES (${b.id}, ${b.student}, ${b.className}, ${b.equipmentId}, ${b.equipmentName}, ${b.quantity}, ${b.reason}, ${b.applyAt}, 'pending')`;
  return { ok: true, borrow: b };
}

async function pgUpdateBorrow(id: string, input: BorrowInput): Promise<{ ok: boolean; error?: string }> {
  const b = await pgGetBorrow(id);
  if (!b) return { ok: false, error: "记录不存在" };
  if (b.status !== "pending") return { ok: false, error: "仅待审批的申请可修改" };
  const eq = await pgGetEquipment(input.equipmentId);
  if (!eq) return { ok: false, error: "所选设备不存在" };
  await sql`
    UPDATE borrows SET student = ${input.student.trim()}, class_name = ${input.className.trim()},
      equipment_id = ${eq.id}, equipment_name = ${eq.name},
      quantity = ${Math.max(1, Math.floor(input.quantity))}, reason = ${(input.reason ?? "").trim()}
    WHERE id = ${id}`;
  return { ok: true };
}

async function pgApproveBorrow(id: string): Promise<{ ok: boolean; error?: string }> {
  const b = await pgGetBorrow(id);
  if (!b) return { ok: false, error: "记录不存在" };
  if (b.status !== "pending") return { ok: false, error: "该申请已处理" };
  const eq = await pgGetEquipment(b.equipmentId);
  if (!eq) return { ok: false, error: "关联设备已不存在，无法批准" };
  const avail = Math.max(0, eq.total - eq.inUse - eq.loaned);
  if (avail < b.quantity)
    return { ok: false, error: `设备「${eq.name}」当前仅剩 ${avail} 件可借，不足以批准 ${b.quantity} 件` };
  await sql`UPDATE equipment SET loaned = ${eq.loaned + b.quantity}, updated_at = ${nowISO()} WHERE id = ${eq.id}`;
  await sql`UPDATE borrows SET status = 'approved', approve_at = ${nowISO()}, reject_reason = '' WHERE id = ${id}`;
  return { ok: true };
}

async function pgRejectBorrow(id: string, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const b = await pgGetBorrow(id);
  if (!b) return { ok: false, error: "记录不存在" };
  if (b.status !== "pending") return { ok: false, error: "该申请已处理" };
  await sql`UPDATE borrows SET status = 'rejected', reject_reason = ${(reason ?? "").trim()} WHERE id = ${id}`;
  return { ok: true };
}

async function pgReturnBorrow(id: string): Promise<{ ok: boolean; error?: string }> {
  const b = await pgGetBorrow(id);
  if (!b) return { ok: false, error: "记录不存在" };
  if (b.status !== "approved") return { ok: false, error: "仅借用中的记录可归还" };
  const eq = await pgGetEquipment(b.equipmentId);
  if (eq) {
    await sql`UPDATE equipment SET loaned = ${Math.max(0, eq.loaned - b.quantity)}, updated_at = ${nowISO()} WHERE id = ${eq.id}`;
  }
  await sql`UPDATE borrows SET status = 'returned', returned_at = ${nowISO()} WHERE id = ${id}`;
  return { ok: true };
}

async function pgDeleteBorrow(id: string): Promise<void> {
  await ensureSchema();
  await sql`DELETE FROM borrows WHERE id = ${id}`;
}

export interface PrintInput {
  student: string;
  className: string;
  phone?: string;
  content: string;
  quantity: number;
  material: string;
  note?: string;
}

async function pgListPrints(): Promise<PrintOrder[]> {
  await ensureSchema();
  const { rows } = await sql`SELECT * FROM print_orders ORDER BY created_at DESC`;
  return rows.map(rowToPrint);
}

async function pgAddPrint(input: PrintInput): Promise<PrintOrder> {
  await ensureSchema();
  const p: PrintOrder = {
    id: uid(),
    student: input.student.trim(),
    className: input.className.trim(),
    phone: (input.phone ?? "").trim() || undefined,
    content: input.content.trim(),
    quantity: Math.max(1, Math.floor(input.quantity)),
    material: input.material || "PLA",
    note: (input.note ?? "").trim() || undefined,
    status: "pending",
    createdAt: nowISO(),
  };
  await sql`
    INSERT INTO print_orders (id, student, class_name, phone, content, quantity, material, note, status, created_at)
    VALUES (${p.id}, ${p.student}, ${p.className}, ${p.phone ?? ""}, ${p.content}, ${p.quantity}, ${p.material}, ${p.note ?? ""}, 'pending', ${p.createdAt})`;
  return p;
}

export type PrintAction = "start" | "finish" | "deliver" | "reject";

async function pgActPrint(id: string, action: PrintAction, reason?: string): Promise<{ ok: boolean; error?: string }> {
  await ensureSchema();
  const { rows } = await sql`SELECT status FROM print_orders WHERE id = ${id} LIMIT 1`;
  const cur = rows[0]?.status as PrintOrder["status"] | undefined;
  if (!cur) return { ok: false, error: "工单不存在" };
  const t = nowISO();
  switch (action) {
    case "start":
      if (cur !== "pending") return { ok: false, error: "仅待接单工单可开始打印" };
      await sql`UPDATE print_orders SET status = 'printing', start_at = ${t} WHERE id = ${id}`;
      break;
    case "finish":
      if (cur !== "printing") return { ok: false, error: "仅打印中的工单可标记完成" };
      await sql`UPDATE print_orders SET status = 'done', finish_at = ${t} WHERE id = ${id}`;
      break;
    case "deliver":
      if (cur !== "done") return { ok: false, error: "仅已完成工单可确认交付" };
      await sql`UPDATE print_orders SET status = 'delivered', deliver_at = ${t} WHERE id = ${id}`;
      break;
    case "reject":
      if (cur !== "pending") return { ok: false, error: "仅待接单工单可拒绝" };
      await sql`UPDATE print_orders SET status = 'rejected', reject_reason = ${(reason ?? "").trim()} WHERE id = ${id}`;
      break;
  }
  return { ok: true };
}

async function pgDeletePrint(id: string): Promise<void> {
  await ensureSchema();
  await sql`DELETE FROM print_orders WHERE id = ${id}`;
}

async function pgGetStats() {
  const [eqs, borrows, prints] = await Promise.all([pgListEquipment(), pgListBorrows(), pgListPrints()]);
  const total = eqs.reduce((s, e) => s + e.total, 0);
  const inUse = eqs.reduce((s, e) => s + e.inUse, 0);
  const loaned = eqs.reduce((s, e) => s + e.loaned, 0);
  return {
    equipment: { kinds: eqs.length, total, inUse, loaned, available: total - inUse - loaned },
    borrows: {
      pending: borrows.filter((b) => b.status === "pending").length,
      active: borrows.filter((b) => b.status === "approved").length,
      returned: borrows.filter((b) => b.status === "returned").length,
      rejected: borrows.filter((b) => b.status === "rejected").length,
    },
    prints: {
      pending: prints.filter((p) => p.status === "pending").length,
      printing: prints.filter((p) => p.status === "printing").length,
      done: prints.filter((p) => p.status === "done").length,
      delivered: prints.filter((p) => p.status === "delivered").length,
      rejected: prints.filter((p) => p.status === "rejected").length,
    },
  };
}

// ============================================================
// 本地 JSON 文件实现（无 POSTGRES_URL 时的本地开发回退）
// ============================================================

export interface DBShape {
  version: number;
  equipment: Equipment[];
  borrows: BorrowRecord[];
  prints: PrintOrder[];
}

const DB_FILE = path.join(process.cwd(), ".data", "db.json");

let cache: DBShape | null = null;

function emptyDB(): DBShape {
  return { version: 1, equipment: [], borrows: [], prints: [] };
}

function load(): DBShape {
  if (cache) return cache;
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
      cache = { ...raw };
      return cache!;
    }
  } catch {
    // 损坏则重建
  }
  const s = emptyDB();
  cache = s;
  persist(s);
  return s;
}

function persist(db: DBShape) {
  try {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf-8");
  } catch (e) {
    console.error("[store] 写入失败", e);
  }
}

function mutate<T>(fn: (db: DBShape) => T): T {
  const db = load();
  const out = fn(db);
  persist(db);
  return out;
}

function jListEquipment(): Equipment[] {
  return [...load().equipment].sort((a, b) => a.name.localeCompare(b.name, "zh"));
}

function jGetEquipment(id: string): Equipment | undefined {
  return load().equipment.find((e) => e.id === id);
}

function jAddEquipment(input: EquipmentInput): Equipment {
  const eq = mergeEq(
    { id: uid(), name: "", category: "未分类", total: 0, inUse: 0, loaned: 0, remark: "", createdAt: nowISO(), updatedAt: nowISO() },
    input
  );
  mutate((db) => {
    db.equipment.push(eq);
  });
  return eq;
}

function jUpdateEquipment(id: string, input: EquipmentInput): Equipment | null {
  return mutate((db) => {
    const idx = db.equipment.findIndex((e) => e.id === id);
    if (idx < 0) return null;
    db.equipment[idx] = mergeEq(db.equipment[idx], input);
    return db.equipment[idx];
  });
}

/** 删除设备：存在未归还借出记录时禁止 */
function jDeleteEquipment(id: string): { ok: boolean; reason?: string } {
  return mutate((db) => {
    const eq = db.equipment.find((e) => e.id === id);
    if (!eq) return { ok: false, reason: "设备不存在" };
    const active = db.borrows.some((b) => b.equipmentId === id && b.status === "approved");
    if (active) return { ok: false, reason: "该设备存在未归还的借出记录，请先全部归还" };
    db.equipment = db.equipment.filter((e) => e.id !== id);
    return { ok: true };
  });
}

function jListBorrows(): BorrowRecord[] {
  return [...load().borrows].sort((a, b) => b.applyAt.localeCompare(a.applyAt));
}

function jAddBorrow(input: BorrowInput): { ok: boolean; borrow?: BorrowRecord; error?: string } {
  const eq = jGetEquipment(input.equipmentId);
  if (!eq) return { ok: false, error: "所选设备不存在" };
  const qty = Math.max(1, Math.floor(input.quantity));
  return mutate((db) => {
    const b: BorrowRecord = {
      id: uid(),
      student: input.student.trim(),
      className: input.className.trim(),
      equipmentId: eq.id,
      equipmentName: eq.name,
      quantity: qty,
      reason: (input.reason ?? "").trim(),
      applyAt: nowISO(),
      status: "pending",
    };
    db.borrows.push(b);
    return { ok: true, borrow: b };
  });
}

function jUpdateBorrow(id: string, input: BorrowInput): { ok: boolean; error?: string } {
  return mutate((db) => {
    const b = db.borrows.find((x) => x.id === id);
    if (!b) return { ok: false, error: "记录不存在" };
    if (b.status !== "pending") return { ok: false, error: "仅待审批的申请可修改" };
    const eq = db.equipment.find((e) => e.id === input.equipmentId);
    if (!eq) return { ok: false, error: "所选设备不存在" };
    b.student = input.student.trim();
    b.className = input.className.trim();
    b.equipmentId = eq.id;
    b.equipmentName = eq.name;
    b.quantity = Math.max(1, Math.floor(input.quantity));
    b.reason = (input.reason ?? "").trim();
    return { ok: true };
  });
}

/** 批准：扣减设备可用数量（借出数增加） */
function jApproveBorrow(id: string): { ok: boolean; error?: string } {
  return mutate((db) => {
    const b = db.borrows.find((x) => x.id === id);
    if (!b) return { ok: false, error: "记录不存在" };
    if (b.status !== "pending") return { ok: false, error: "该申请已处理" };
    const eq = db.equipment.find((e) => e.id === b.equipmentId);
    if (!eq) return { ok: false, error: "关联设备已不存在，无法批准" };
    const avail = Math.max(0, eq.total - eq.inUse - eq.loaned);
    if (avail < b.quantity)
      return { ok: false, error: `设备「${eq.name}」当前仅剩 ${avail} 件可借，不足以批准 ${b.quantity} 件` };
    eq.loaned += b.quantity;
    eq.updatedAt = nowISO();
    b.status = "approved";
    b.approveAt = nowISO();
    b.rejectReason = undefined;
    return { ok: true };
  });
}

function jRejectBorrow(id: string, reason?: string): { ok: boolean; error?: string } {
  return mutate((db) => {
    const b = db.borrows.find((x) => x.id === id);
    if (!b) return { ok: false, error: "记录不存在" };
    if (b.status !== "pending") return { ok: false, error: "该申请已处理" };
    b.status = "rejected";
    b.rejectReason = (reason ?? "").trim();
    return { ok: true };
  });
}

/** 归还：恢复设备可用数量 */
function jReturnBorrow(id: string): { ok: boolean; error?: string } {
  return mutate((db) => {
    const b = db.borrows.find((x) => x.id === id);
    if (!b) return { ok: false, error: "记录不存在" };
    if (b.status !== "approved") return { ok: false, error: "仅借用中的记录可归还" };
    const eq = db.equipment.find((e) => e.id === b.equipmentId);
    if (eq) {
      eq.loaned = Math.max(0, eq.loaned - b.quantity);
      eq.updatedAt = nowISO();
    }
    b.status = "returned";
    b.returnedAt = nowISO();
    return { ok: true };
  });
}

function jDeleteBorrow(id: string): void {
  mutate((db) => {
    db.borrows = db.borrows.filter((x) => x.id !== id);
  });
}

function jListPrints(): PrintOrder[] {
  return [...load().prints].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function jAddPrint(input: PrintInput): PrintOrder {
  const p: PrintOrder = {
    id: uid(),
    student: input.student.trim(),
    className: input.className.trim(),
    phone: (input.phone ?? "").trim() || undefined,
    content: input.content.trim(),
    quantity: Math.max(1, Math.floor(input.quantity)),
    material: input.material || "PLA",
    note: (input.note ?? "").trim() || undefined,
    status: "pending",
    createdAt: nowISO(),
  };
  mutate((db) => {
    db.prints.push(p);
  });
  return p;
}

function jActPrint(id: string, action: PrintAction, reason?: string): { ok: boolean; error?: string } {
  return mutate((db) => {
    const p = db.prints.find((x) => x.id === id);
    if (!p) return { ok: false, error: "工单不存在" };
    const t = nowISO();
    switch (action) {
      case "start":
        if (p.status !== "pending") return { ok: false, error: "仅待接单工单可开始打印" };
        p.status = "printing";
        p.startAt = t;
        break;
      case "finish":
        if (p.status !== "printing") return { ok: false, error: "仅打印中的工单可标记完成" };
        p.status = "done";
        p.finishAt = t;
        break;
      case "deliver":
        if (p.status !== "done") return { ok: false, error: "仅已完成工单可确认交付" };
        p.status = "delivered";
        p.deliverAt = t;
        break;
      case "reject":
        if (p.status !== "pending") return { ok: false, error: "仅待接单工单可拒绝" };
        p.status = "rejected";
        p.rejectReason = (reason ?? "").trim();
        break;
    }
    return { ok: true };
  });
}

function jDeletePrint(id: string): void {
  mutate((db) => {
    db.prints = db.prints.filter((x) => x.id !== id);
  });
}

function jGetStats() {
  const db = load();
  const eqs = db.equipment;
  const total = eqs.reduce((s, e) => s + e.total, 0);
  const inUse = eqs.reduce((s, e) => s + e.inUse, 0);
  const loaned = eqs.reduce((s, e) => s + e.loaned, 0);
  const available = total - inUse - loaned;
  return {
    equipment: { kinds: eqs.length, total, inUse, loaned, available },
    borrows: {
      pending: db.borrows.filter((b) => b.status === "pending").length,
      active: db.borrows.filter((b) => b.status === "approved").length,
      returned: db.borrows.filter((b) => b.status === "returned").length,
      rejected: db.borrows.filter((b) => b.status === "rejected").length,
    },
    prints: {
      pending: db.prints.filter((p) => p.status === "pending").length,
      printing: db.prints.filter((p) => p.status === "printing").length,
      done: db.prints.filter((p) => p.status === "done").length,
      delivered: db.prints.filter((p) => p.status === "delivered").length,
      rejected: db.prints.filter((p) => p.status === "rejected").length,
    },
  };
}

// ============================================================
// 统一出口：有 POSTGRES_URL 走 Postgres，否则走本地 JSON
// ============================================================

export function listEquipment(): Promise<Equipment[]> {
  return usePg ? pgListEquipment() : Promise.resolve(jListEquipment());
}

export function addEquipment(input: EquipmentInput): Promise<Equipment> {
  return usePg ? pgAddEquipment(input) : Promise.resolve(jAddEquipment(input));
}

export function updateEquipment(id: string, input: EquipmentInput): Promise<Equipment | null> {
  return usePg ? pgUpdateEquipment(id, input) : Promise.resolve(jUpdateEquipment(id, input));
}

export function deleteEquipment(id: string): Promise<{ ok: boolean; reason?: string }> {
  return usePg ? pgDeleteEquipment(id) : Promise.resolve(jDeleteEquipment(id));
}

export function listBorrows(): Promise<BorrowRecord[]> {
  return usePg ? pgListBorrows() : Promise.resolve(jListBorrows());
}

export function addBorrow(input: BorrowInput): Promise<{ ok: boolean; borrow?: BorrowRecord; error?: string }> {
  return usePg ? pgAddBorrow(input) : Promise.resolve(jAddBorrow(input));
}

export function updateBorrow(id: string, input: BorrowInput): Promise<{ ok: boolean; error?: string }> {
  return usePg ? pgUpdateBorrow(id, input) : Promise.resolve(jUpdateBorrow(id, input));
}

export function approveBorrow(id: string): Promise<{ ok: boolean; error?: string }> {
  return usePg ? pgApproveBorrow(id) : Promise.resolve(jApproveBorrow(id));
}

export function rejectBorrow(id: string, reason?: string): Promise<{ ok: boolean; error?: string }> {
  return usePg ? pgRejectBorrow(id, reason) : Promise.resolve(jRejectBorrow(id, reason));
}

export function returnBorrow(id: string): Promise<{ ok: boolean; error?: string }> {
  return usePg ? pgReturnBorrow(id) : Promise.resolve(jReturnBorrow(id));
}

export function deleteBorrow(id: string): Promise<void> {
  return usePg ? pgDeleteBorrow(id) : Promise.resolve(jDeleteBorrow(id));
}

export function listPrints(): Promise<PrintOrder[]> {
  return usePg ? pgListPrints() : Promise.resolve(jListPrints());
}

export function addPrint(input: PrintInput): Promise<PrintOrder> {
  return usePg ? pgAddPrint(input) : Promise.resolve(jAddPrint(input));
}

export function actPrint(id: string, action: PrintAction, reason?: string): Promise<{ ok: boolean; error?: string }> {
  return usePg ? pgActPrint(id, action, reason) : Promise.resolve(jActPrint(id, action, reason));
}

export function deletePrint(id: string): Promise<void> {
  return usePg ? pgDeletePrint(id) : Promise.resolve(jDeletePrint(id));
}

export function getStats() {
  return usePg ? pgGetStats() : Promise.resolve(jGetStats());
}
