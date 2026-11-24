// ============ 数据类型定义（前后端共用） ============

/** 资产类型：固定资产 / 低值物资 */
export type AssetType = "fixed" | "low";

/** 设备台账 */
export interface Equipment {
  id: string;
  assetNo: string;     // 资产编号（如 PHGD/DZ-5-2026-034）
  name: string;        // 设备名称
  spec: string;        // 规格型号
  category: string;    // 分类（摄影 / 创客 / 电子设备…）
  assetType: AssetType;// 固定资产 / 低值物资
  unit: string;        // 单位（台 / 套 / 个…）
  price: number;       // 单价（元）
  total: number;       // 总数
  inUse: number;       // 在用（学校内部占用）
  loaned: number;      // 借出（学生借出中，由借用系统自动增减）
  remark: string;      // 备注
  createdAt: string;
  updatedAt: string;
}

/** 设备派生视图 */
export type EqStatusKey = "idle" | "inuse" | "loaned" | "partial" | "empty";

export interface EquipmentView extends Equipment {
  available: number; // 剩余 / 空闲 = total - inUse - loaned
  statusKey: EqStatusKey;
}

/** 借用状态：待审批 -> 借用中 -> 已归还（/ 已拒绝） */
export type BorrowStatus = "pending" | "approved" | "returned" | "rejected";

export interface BorrowRecord {
  id: string;
  student: string;     // 学生姓名
  className: string;   // 班级
  equipmentId: string;
  equipmentName: string; // 设备名称快照
  quantity: number;
  reason: string;      // 借用用途
  applyAt: string;     // 申请时间
  approveAt?: string;
  returnedAt?: string;
  rejectReason?: string;
  status: BorrowStatus;
}

/** 3D 打印工单状态：待接单 -> 打印中 -> 打印完成(待交付) -> 已交付 */
export type PrintStatus = "pending" | "printing" | "done" | "delivered" | "rejected";

export interface PrintOrder {
  id: string;
  student: string;
  className: string;
  phone?: string;
  content: string;     // 打印需求描述
  quantity: number;
  material: string;    // 材料
  note?: string;
  status: PrintStatus;
  createdAt: string;
  startAt?: string;
  finishAt?: string;
  deliverAt?: string;
  rejectReason?: string;
}

// ============ 学生借用登记（固定资产） ============

/** 借用登记状态：待审核 -> 已通过 -> 已完成（/ 已拒绝 / 已取消） */
export type ReservationStatus = "pending" | "approved" | "completed" | "rejected" | "cancelled";

export interface Reservation {
  id: string;
  student: string;
  className: string;
  phone: string;          // 联系方式
  equipmentId: string;
  equipmentName: string;  // 资产名称快照
  assetNo: string;        // 资产编号快照
  spec: string;           // 规格型号快照
  is3DPrinter: boolean;   // 3D 打印机借用登记需上传 Bambu Studio 文件
  startAt?: string;       // 使用开始时间（非 3D 打印机必填）
  endAt?: string;         // 使用结束时间（非 3D 打印机必填）
  purpose: string;        // 用途 / 打印说明
  fileName?: string;      // 上传文件名
  fileSize?: number;      // 文件大小（字节）
  status: ReservationStatus;
  createdAt: string;
  reviewedAt?: string;
  closedAt?: string;
  rejectReason?: string;
}

/** 可导入 Bambu Studio 的模型文件扩展名 */
export const BAMBU_FILE_EXTENSIONS = [".3mf", ".stl", ".obj", ".step", ".stp", ".amf"] as const;
/** 单个借用登记附件大小上限（25MB） */
export const MAX_RESERVATION_FILE_BYTES = 25 * 1024 * 1024;

export function isAllowedBambuFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return BAMBU_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function is3DPrinter(e: Pick<Equipment, "name" | "spec" | "category">): boolean {
  return /打印机|FDM|Bambu/i.test(`${e.name} ${e.spec} ${e.category}`);
}

// ============ 元信息（徽标 / 文案） ============

export interface ToneMeta {
  label: string;
  tone: string; // tailwind 色键
  dot?: boolean;
}

export const eqStatusMeta: Record<EqStatusKey, ToneMeta> = {
  idle: { label: "空闲", tone: "emerald" },
  inuse: { label: "全部在用", tone: "sky" },
  loaned: { label: "全部借出", tone: "amber" },
  partial: { label: "部分占用", tone: "violet" },
  empty: { label: "无库存", tone: "slate" },
};

export const assetTypeMeta: Record<AssetType, ToneMeta> = {
  fixed: { label: "固定资产", tone: "indigo" },
  low: { label: "低值物资", tone: "slate" },
};

export const reservationStatusMeta: Record<ReservationStatus, ToneMeta> = {
  pending: { label: "待审核", tone: "amber", dot: true },
  approved: { label: "已通过", tone: "sky", dot: true },
  completed: { label: "已完成", tone: "emerald" },
  rejected: { label: "已拒绝", tone: "rose" },
  cancelled: { label: "已取消", tone: "slate" },
};

export const borrowStatusMeta: Record<BorrowStatus, ToneMeta> = {
  pending: { label: "待审批", tone: "amber", dot: true },
  approved: { label: "借用中", tone: "sky", dot: true },
  returned: { label: "已归还", tone: "emerald" },
  rejected: { label: "已拒绝", tone: "rose" },
};

export const printStatusMeta: Record<PrintStatus, ToneMeta> = {
  pending: { label: "待接单", tone: "violet", dot: true },
  printing: { label: "打印中", tone: "sky", dot: true },
  done: { label: "待交付", tone: "amber", dot: true },
  delivered: { label: "已交付", tone: "emerald" },
  rejected: { label: "已拒绝", tone: "rose" },
};

export const MATERIALS = ["PLA", "PETG", "TPU", "ABS", "光敏树脂", "其他"] as const;

// ============ 派生计算（前后端共用） ============

export function availableOf(e: Equipment): number {
  return Math.max(0, e.total - e.inUse - e.loaned);
}

export function statusKeyOf(e: Equipment): EqStatusKey {
  const { total, inUse, loaned } = e;
  if (total <= 0) return "empty";
  const avail = Math.max(0, total - inUse - loaned);
  if (inUse <= 0 && loaned <= 0) return "idle";
  if (avail <= 0) {
    if (inUse > 0 && loaned <= 0) return "inuse";
    if (loaned > 0 && inUse <= 0) return "loaned";
    return "partial";
  }
  return "partial";
}

export function toView(e: Equipment): EquipmentView {
  return { ...e, available: availableOf(e), statusKey: statusKeyOf(e) };
}

export const nowISO = () => new Date().toISOString();

export function uid(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  );
}
