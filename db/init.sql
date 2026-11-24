-- ============================================================
-- 数据库结构（供第二步接入 Vercel Postgres / Neon 使用）
-- 用法：在 Vercel 创建 Postgres 数据库后，把连接串填入环境变量，
--       然后在本地执行：psql "$POSTGRES_URL" -f db/init.sql
-- 说明：应用启动时也会自动建表 / 补列，此文件仅供参考。
-- ============================================================

CREATE TABLE IF NOT EXISTS equipment (
  id          TEXT PRIMARY KEY,
  asset_no    TEXT NOT NULL DEFAULT '',   -- 资产编号（固定资产沿用原编号，低值物资逐件编号）
  name        TEXT NOT NULL,
  spec        TEXT NOT NULL DEFAULT '',   -- 规格型号
  category    TEXT NOT NULL DEFAULT '未分类',
  asset_type  TEXT NOT NULL DEFAULT 'fixed', -- fixed=固定资产，low=低值物资
  unit        TEXT NOT NULL DEFAULT '件',
  price       NUMERIC(12,2) NOT NULL DEFAULT 0,
  total       INTEGER NOT NULL DEFAULT 0,
  in_use      INTEGER NOT NULL DEFAULT 0,
  loaned      INTEGER NOT NULL DEFAULT 0,
  remark      TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_equipment_name ON equipment (name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_asset_no ON equipment (asset_no) WHERE asset_no <> '';

-- 旧低值物资借用表（历史数据保留；当前「学生借用登记」使用 reservations 表）
CREATE TABLE IF NOT EXISTS borrows (
  id             TEXT PRIMARY KEY,
  student        TEXT NOT NULL,
  class_name     TEXT NOT NULL,
  equipment_id   TEXT NOT NULL REFERENCES equipment(id) ON DELETE RESTRICT,
  equipment_name TEXT NOT NULL,
  quantity       INTEGER NOT NULL DEFAULT 1,
  reason         TEXT NOT NULL DEFAULT '',
  apply_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  approve_at     TIMESTAMPTZ,
  returned_at    TIMESTAMPTZ,
  reject_reason  TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','returned','rejected'))
);
CREATE INDEX IF NOT EXISTS idx_borrows_status ON borrows (status);
CREATE INDEX IF NOT EXISTS idx_borrows_student ON borrows (student);

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
);
CREATE INDEX IF NOT EXISTS idx_prints_status ON print_orders (status);
CREATE INDEX IF NOT EXISTS idx_prints_student ON print_orders (student);

-- 学生借用登记（固定资产；3D 打印机需上传模型文件，其它设备需使用时间段）
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
);
CREATE INDEX IF NOT EXISTS idx_reservations_equipment_time ON reservations (equipment_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations (status);

-- 借用登记附件（Bambu Studio 可导入的 .3mf / .stl / .obj / .step 等）
CREATE TABLE IF NOT EXISTS reservation_files (
  reservation_id TEXT PRIMARY KEY REFERENCES reservations(id) ON DELETE CASCADE,
  file_name      TEXT NOT NULL,
  mime           TEXT NOT NULL DEFAULT 'application/octet-stream',
  size           INTEGER NOT NULL DEFAULT 0,
  data           BYTEA NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
