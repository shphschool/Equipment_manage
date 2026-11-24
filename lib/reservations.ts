// ============================================================
// 学生借用登记数据层
//   - 有 POSTGRES_URL → reservations / reservation_files（附件存 bytea）
//   - 本地开发 → .data/reservations.json（附件用 base64 保存）
// 上层 API 只需调用本文件导出的异步函数。
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { sql } from "@vercel/postgres";
import { getEquipment } from "./store";
import {
  is3DPrinter, isAllowedBambuFile, MAX_RESERVATION_FILE_BYTES, nowISO, uid,
  type Equipment, type Reservation, type ReservationStatus,
} from "./types";

const usePg = !!process.env.POSTGRES_URL;

export interface ReservationInput {
  student: string;
  className: string;
  phone: string;
  equipmentId: string;
  startAt?: string;
  endAt?: string;
  purpose?: string;
}

export interface ReservationFileInput {
  name: string;
  mime: string;
  size: number;
  data: Buffer;
}

export interface ReservationFile {
  name: string;
  mime: string;
  size: number;
  data: Buffer;
}

export type ReservationAction = "approve" | "reject" | "complete" | "cancel";

export interface ReservationResult {
  ok: boolean;
  reservation?: Reservation;
  error?: string;
  conflict?: boolean;
}

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : String(v ?? "");

function cnTime(isoStr?: string): string {
  if (!isoStr) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(isoStr));
}

// ============================================================
// Postgres 实现
// ============================================================

let schemaReady: Promise<unknown> | null = null;

function ensureSchema() {
  if (!schemaReady) {
    schemaReady = sql`
      CREATE TABLE IF NOT EXISTS reservations (
        id             TEXT PRIMARY KEY,
        student        TEXT NOT NULL,
        class_name     TEXT NOT NULL,
        phone          TEXT NOT NULL DEFAULT '',
        equipment_id   TEXT NOT NULL,
        equipment_name TEXT NOT NULL,
        asset_no       TEXT NOT NULL DEFAULT '',
        spec           TEXT NOT NULL DEFAULT '',
        is_3d_printer  BOOLEAN NOT NULL DEFAULT false,
        start_at       TIMESTAMPTZ,
        end_at         TIMESTAMPTZ,
        purpose        TEXT NOT NULL DEFAULT '',
        file_name      TEXT NOT NULL DEFAULT '',
        file_size      INTEGER NOT NULL DEFAULT 0,
        status         TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','approved','completed','rejected','cancelled')),
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        reviewed_at    TIMESTAMPTZ,
        closed_at      TIMESTAMPTZ,
        reject_reason  TEXT NOT NULL DEFAULT ''
      )`
      .then(() => sql`
        CREATE TABLE IF NOT EXISTS reservation_files (
          reservation_id TEXT PRIMARY KEY REFERENCES reservations(id) ON DELETE CASCADE,
          file_name      TEXT NOT NULL,
          mime           TEXT NOT NULL DEFAULT 'application/octet-stream',
          size           INTEGER NOT NULL DEFAULT 0,
          data           BYTEA NOT NULL,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        )`)
      .then(() => sql`CREATE INDEX IF NOT EXISTS idx_reservations_equipment_time ON reservations (equipment_id, start_at, end_at)`)
      .then(() => sql`CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations (status)`);
  }
  return schemaReady;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToReservation(r: any): Reservation {
  return {
    id: r.id,
    student: r.student,
    className: r.class_name,
    phone: r.phone ?? "",
    equipmentId: r.equipment_id,
    equipmentName: r.equipment_name,
    assetNo: r.asset_no ?? "",
    spec: r.spec ?? "",
    is3DPrinter: !!r.is_3d_printer,
    startAt: r.start_at ? iso(r.start_at) : undefined,
    endAt: r.end_at ? iso(r.end_at) : undefined,
    purpose: r.purpose ?? "",
    fileName: r.file_name || undefined,
    fileSize: r.file_size ? Number(r.file_size) : undefined,
    status: r.status as ReservationStatus,
    createdAt: iso(r.created_at),
    reviewedAt: r.reviewed_at ? iso(r.reviewed_at) : undefined,
    closedAt: r.closed_at ? iso(r.closed_at) : undefined,
    rejectReason: r.reject_reason || undefined,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function pgFindConflict(
  equipmentId: string,
  startAt: string,
  endAt: string,
  excludeId?: string
): Promise<{ student: string; start_at: Date | string; end_at: Date | string } | null> {
  await ensureSchema();
  const base = `SELECT student, start_at, end_at FROM reservations
    WHERE equipment_id = $1 AND status IN ('pending','approved')
      AND start_at IS NOT NULL AND end_at IS NOT NULL
      AND start_at < $3 AND end_at > $2`;
  const params: unknown[] = [equipmentId, startAt, endAt];
  let text = base;
  if (excludeId) {
    params.push(excludeId);
    text += ` AND id <> $4`;
  }
  text += ` ORDER BY start_at LIMIT 1`;
  const { rows } = await sql.query(text, params);
  return rows[0] ?? null;
}

async function pgListReservations(): Promise<Reservation[]> {
  await ensureSchema();
  const { rows } = await sql`SELECT * FROM reservations ORDER BY created_at DESC`;
  return rows.map(rowToReservation);
}

async function pgGetReservation(id: string): Promise<Reservation | undefined> {
  await ensureSchema();
  const { rows } = await sql`SELECT * FROM reservations WHERE id = ${id} LIMIT 1`;
  return rows[0] ? rowToReservation(rows[0]) : undefined;
}

async function pgAddReservation(
  input: ReservationInput,
  file?: ReservationFileInput
): Promise<ReservationResult> {
  const checked = await validateReservation(input, file);
  if (!checked.ok) return checked;
  const { eq, printer, startAt, endAt, purpose } = checked;

  if (!printer && startAt && endAt) {
    const conflict = await pgFindConflict(eq.id, startAt, endAt);
    if (conflict) {
      return {
        ok: false,
        conflict: true,
        error: `该时段与 ${conflict.student} 的借用登记（${cnTime(iso(conflict.start_at))} - ${cnTime(iso(conflict.end_at))}）冲突，请调整使用时间`,
      };
    }
  }

  await ensureSchema();
  const r: Reservation = {
    id: uid(),
    student: String(input.student ?? "").trim(),
    className: String(input.className ?? "").trim(),
    phone: String(input.phone ?? "").trim(),
    equipmentId: eq.id,
    equipmentName: eq.name,
    assetNo: eq.assetNo,
    spec: eq.spec,
    is3DPrinter: printer,
    startAt: printer ? undefined : startAt,
    endAt: printer ? undefined : endAt,
    purpose,
    fileName: file?.name,
    fileSize: file?.size,
    status: "pending",
    createdAt: nowISO(),
  };

  await sql`
    INSERT INTO reservations (
      id, student, class_name, phone, equipment_id, equipment_name, asset_no, spec,
      is_3d_printer, start_at, end_at, purpose, file_name, file_size, status, created_at
    ) VALUES (
      ${r.id}, ${r.student}, ${r.className}, ${r.phone}, ${r.equipmentId}, ${r.equipmentName},
      ${r.assetNo}, ${r.spec}, ${r.is3DPrinter}, ${r.startAt ?? null}, ${r.endAt ?? null},
      ${r.purpose}, ${r.fileName ?? ""}, ${r.fileSize ?? 0}, 'pending', ${r.createdAt}
    )`;

  if (file) {
    try {
      // sql 模板参数只接受 Primitive，二进制附件改用 query 传 Buffer
      await sql.query(
        `INSERT INTO reservation_files (reservation_id, file_name, mime, size, data)
         VALUES ($1, $2, $3, $4, $5)`,
        [r.id, file.name, file.mime, file.size, file.data]
      );
    } catch (e) {
      await sql`DELETE FROM reservations WHERE id = ${r.id}`;
      throw e;
    }
  }

  return { ok: true, reservation: r };
}

async function pgActReservation(
  id: string,
  action: ReservationAction,
  reason?: string
): Promise<ReservationResult> {
  const r = await pgGetReservation(id);
  if (!r) return { ok: false, error: "借用登记不存在" };
  const t = nowISO();

  if (action === "approve") {
    if (r.status !== "pending") return { ok: false, error: "仅待审核的借用登记可以通过" };
    if (!r.is3DPrinter && r.startAt && r.endAt) {
      const conflict = await pgFindConflict(r.equipmentId, r.startAt, r.endAt, r.id);
      if (conflict) {
        return {
          ok: false,
          conflict: true,
          error: `该时段已被 ${conflict.student} 的借用登记占用（${cnTime(iso(conflict.start_at))} - ${cnTime(iso(conflict.end_at))}），无法通过`,
        };
      }
    }
    await sql`UPDATE reservations SET status = 'approved', reviewed_at = ${t}, reject_reason = '' WHERE id = ${id}`;
    return { ok: true };
  }

  if (action === "reject") {
    if (r.status !== "pending") return { ok: false, error: "仅待审核的借用登记可以拒绝" };
    await sql`
      UPDATE reservations SET status = 'rejected', reviewed_at = ${t}, closed_at = ${t},
        reject_reason = ${(reason ?? "").trim()}
      WHERE id = ${id}`;
    return { ok: true };
  }

  if (action === "complete") {
    if (r.status !== "approved") return { ok: false, error: "仅已通过的借用登记可以标记完成" };
    await sql`UPDATE reservations SET status = 'completed', closed_at = ${t} WHERE id = ${id}`;
    return { ok: true };
  }

  if (r.status !== "pending" && r.status !== "approved") {
    return { ok: false, error: "该借用登记已结束，无法取消" };
  }
  await sql`UPDATE reservations SET status = 'cancelled', closed_at = ${t} WHERE id = ${id}`;
  return { ok: true };
}

async function pgDeleteReservation(id: string): Promise<void> {
  await ensureSchema();
  await sql`DELETE FROM reservations WHERE id = ${id}`;
}

async function pgGetReservationFile(id: string): Promise<ReservationFile | null> {
  await ensureSchema();
  const { rows } = await sql`
    SELECT file_name, mime, size, data FROM reservation_files WHERE reservation_id = ${id} LIMIT 1`;
  if (!rows[0]) return null;
  return {
    name: rows[0].file_name,
    mime: rows[0].mime || "application/octet-stream",
    size: Number(rows[0].size ?? 0),
    data: Buffer.from(rows[0].data),
  };
}

// ============================================================
// 本地 JSON 实现
// ============================================================

interface ReservationDB {
  version: number;
  reservations: Reservation[];
  files: Record<string, { name: string; mime: string; size: number; data: string }>;
}

const DB_FILE = path.join(process.cwd(), ".data", "reservations.json");
let cache: ReservationDB | null = null;

function emptyDB(): ReservationDB {
  return { version: 1, reservations: [], files: {} };
}

function load(): ReservationDB {
  if (cache) return cache;
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, "utf-8")) as Partial<ReservationDB>;
      cache = {
        version: 1,
        reservations: Array.isArray(raw.reservations) ? raw.reservations : [],
        files: raw.files && typeof raw.files === "object" ? raw.files : {},
      };
      return cache;
    }
  } catch {
    // 损坏则重建
  }
  cache = emptyDB();
  persist(cache);
  return cache;
}

function persist(db: ReservationDB) {
  try {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db), "utf-8");
  } catch (e) {
    console.error("[reservations] 写入失败", e);
  }
}

function mutate<T>(fn: (db: ReservationDB) => T): T {
  const db = load();
  const out = fn(db);
  persist(db);
  return out;
}

function jListReservations(): Reservation[] {
  return [...load().reservations].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function jFindConflict(
  equipmentId: string,
  startAt: string,
  endAt: string,
  excludeId?: string
): Reservation | null {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  return (
    load().reservations.find((r) => {
      if (r.id === excludeId) return false;
      if (r.equipmentId !== equipmentId) return false;
      if (r.status !== "pending" && r.status !== "approved") return false;
      if (!r.startAt || !r.endAt) return false;
      return new Date(r.startAt).getTime() < end && new Date(r.endAt).getTime() > start;
    }) ?? null
  );
}

async function jAddReservation(
  input: ReservationInput,
  file?: ReservationFileInput
): Promise<ReservationResult> {
  const checked = await validateReservation(input, file);
  if (!checked.ok) return checked;
  const { eq, printer, startAt, endAt, purpose } = checked;

  if (!printer && startAt && endAt) {
    const conflict = jFindConflict(eq.id, startAt, endAt);
    if (conflict) {
      return {
        ok: false,
        conflict: true,
        error: `该时段与 ${conflict.student} 的借用登记（${cnTime(conflict.startAt)} - ${cnTime(conflict.endAt)}）冲突，请调整使用时间`,
      };
    }
  }

  return mutate((db) => {
    const r: Reservation = {
      id: uid(),
      student: input.student.trim(),
      className: input.className.trim(),
      phone: input.phone.trim(),
      equipmentId: eq.id,
      equipmentName: eq.name,
      assetNo: eq.assetNo,
      spec: eq.spec,
      is3DPrinter: printer,
      startAt: printer ? undefined : startAt,
      endAt: printer ? undefined : endAt,
      purpose,
      fileName: file?.name,
      fileSize: file?.size,
      status: "pending",
      createdAt: nowISO(),
    };
    db.reservations.push(r);
    if (file) {
      db.files[r.id] = {
        name: file.name,
        mime: file.mime,
        size: file.size,
        data: file.data.toString("base64"),
      };
    }
    return { ok: true, reservation: r };
  });
}

function jActReservation(
  id: string,
  action: ReservationAction,
  reason?: string
): ReservationResult {
  return mutate((db) => {
    const r = db.reservations.find((x) => x.id === id);
    if (!r) return { ok: false, error: "借用登记不存在" };
    const t = nowISO();

    if (action === "approve") {
      if (r.status !== "pending") return { ok: false, error: "仅待审核的借用登记可以通过" };
      if (!r.is3DPrinter && r.startAt && r.endAt) {
        const conflict = jFindConflict(r.equipmentId, r.startAt, r.endAt, r.id);
        if (conflict) {
          return {
            ok: false,
            conflict: true,
            error: `该时段已被 ${conflict.student} 的借用登记占用（${cnTime(conflict.startAt)} - ${cnTime(conflict.endAt)}），无法通过`,
          };
        }
      }
      r.status = "approved";
      r.reviewedAt = t;
      r.rejectReason = undefined;
      return { ok: true };
    }

    if (action === "reject") {
      if (r.status !== "pending") return { ok: false, error: "仅待审核的借用登记可以拒绝" };
      r.status = "rejected";
      r.reviewedAt = t;
      r.closedAt = t;
      r.rejectReason = (reason ?? "").trim() || undefined;
      return { ok: true };
    }

    if (action === "complete") {
      if (r.status !== "approved") return { ok: false, error: "仅已通过的借用登记可以标记完成" };
      r.status = "completed";
      r.closedAt = t;
      return { ok: true };
    }

    if (r.status !== "pending" && r.status !== "approved") {
      return { ok: false, error: "该借用登记已结束，无法取消" };
    }
    r.status = "cancelled";
    r.closedAt = t;
    return { ok: true };
  });
}

function jDeleteReservation(id: string): void {
  mutate((db) => {
    db.reservations = db.reservations.filter((r) => r.id !== id);
    delete db.files[id];
  });
}

function jGetReservationFile(id: string): ReservationFile | null {
  const f = load().files[id];
  if (!f) return null;
  const data = Buffer.from(f.data, "base64");
  return { name: f.name, mime: f.mime, size: f.size || data.length, data };
}

// ============================================================
// 校验与统一出口
// ============================================================

interface CheckedReservation {
  ok: true;
  eq: Equipment;
  printer: boolean;
  startAt?: string;
  endAt?: string;
  purpose: string;
}

async function validateReservation(
  input: ReservationInput,
  file?: ReservationFileInput
): Promise<CheckedReservation | { ok: false; error: string; conflict?: boolean }> {
  const student = String(input.student ?? "").trim();
  const className = String(input.className ?? "").trim();
  const phone = String(input.phone ?? "").trim();
  if (!student) return { ok: false, error: "请填写学生姓名" };
  if (!className) return { ok: false, error: "请填写班级" };
  if (!phone) return { ok: false, error: "请填写联系方式" };

  const eq = await getEquipment(String(input.equipmentId ?? ""));
  if (!eq) return { ok: false, error: "所选资产不存在" };
  if (eq.assetType !== "fixed") return { ok: false, error: "借用登记仅适用于固定资产" };

  const printer = is3DPrinter(eq);
  const purpose = String(input.purpose ?? "").trim();

  if (printer) {
    if (!file) return { ok: false, error: "3D 打印机借用登记必须上传可导入 Bambu Studio 的模型文件" };
    if (!isAllowedBambuFile(file.name)) {
      return { ok: false, error: `文件格式不支持，请上传 ${".3mf / .stl / .obj / .step / .stp / .amf"} 文件` };
    }
    if (file.size <= 0) return { ok: false, error: "上传的文件为空" };
    if (file.size > MAX_RESERVATION_FILE_BYTES) {
      return { ok: false, error: `文件不能超过 ${Math.floor(MAX_RESERVATION_FILE_BYTES / 1024 / 1024)}MB` };
    }
    return { ok: true, eq, printer, purpose };
  }

  if (!input.startAt || !input.endAt) return { ok: false, error: "请选择使用开始和结束时间" };
  const start = new Date(input.startAt);
  const end = new Date(input.endAt);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return { ok: false, error: "使用时间格式不正确" };
  if (end.getTime() <= start.getTime()) return { ok: false, error: "结束时间必须晚于开始时间" };
  return {
    ok: true,
    eq,
    printer,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    purpose,
  };
}

export function listReservations(): Promise<Reservation[]> {
  return usePg ? pgListReservations() : Promise.resolve(jListReservations());
}

export function addReservation(
  input: ReservationInput,
  file?: ReservationFileInput
): Promise<ReservationResult> {
  return usePg ? pgAddReservation(input, file) : jAddReservation(input, file);
}

export function actReservation(
  id: string,
  action: ReservationAction,
  reason?: string
): Promise<ReservationResult> {
  return usePg ? pgActReservation(id, action, reason) : Promise.resolve(jActReservation(id, action, reason));
}

export function deleteReservation(id: string): Promise<void> {
  return usePg ? pgDeleteReservation(id) : Promise.resolve(jDeleteReservation(id));
}

export function getReservationFile(id: string): Promise<ReservationFile | null> {
  return usePg ? pgGetReservationFile(id) : Promise.resolve(jGetReservationFile(id));
}
