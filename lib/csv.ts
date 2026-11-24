// ============ CSV 解析 / 列映射 / 行规范化（浏览器端执行，便于导入前预览） ============

export interface ParsedCSV {
  headers: string[];
  rows: string[][];
}

/** 简易 RFC4180 解析：支持引号、逗号、换行、BOM */
export function parseCSV(text: string): ParsedCSV {
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let cur = "";
  let row: string[] = [];
  let inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n") {
      row.push(cur);
      cur = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => h.trim());
  return { headers, rows: rows.slice(1) };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "").replace(/[_-]/g, "");

// 支持的列及别名（自动识别中文 / 英文表头）
export type FieldKey =
  | "assetNo" | "name" | "spec" | "category" | "assetType"
  | "unit" | "price" | "total" | "inUse" | "loaned" | "available" | "remark";

const FIELD_ALIASES: Record<FieldKey, string[]> = {
  assetNo: ["固定资产编号", "资产编号", "资产编码", "编号", "assetno", "assetid", "assetcode", "propertyno"],
  name: ["资产名称", "设备名称", "名称", "设备", "物品", "name", "equipment", "device", "item", "equipmentname"],
  spec: ["规格型号", "规格", "型号", "spec", "model", "specification"],
  category: ["分类", "类别", "设备分类", "category", "kind"],
  assetType: ["资产类型", "资产类别", "类型", "assettype"],
  unit: ["单位", "unit"],
  price: ["单价", "价格", "金额", "price", "unitprice"],
  total: ["总数", "总数量", "数量", "总数(台)", "total", "count", "qty", "quantity", "all", "sum"],
  inUse: ["在用", "使用中", "在用数", "占用", "inuse", "inuse数量"],
  loaned: ["借出", "已借出", "借出数", "外借", "loan", "loaned", "lend", "borrowed", "out"],
  available: ["剩余", "剩余数量", "空闲", "空闲数量", "可用", "available", "remaining", "stock", "left", "库存"],
  remark: ["备注", "说明", "注释", "note", "remark", "notes", "memo", "description", "desc"],
};

export const FIELD_LABELS: Record<FieldKey, string> = {
  assetNo: "资产编号",
  name: "设备名称",
  spec: "规格型号",
  category: "分类",
  assetType: "资产类型",
  unit: "单位",
  price: "单价",
  total: "总数",
  inUse: "在用",
  loaned: "借出",
  available: "剩余数量",
  remark: "备注",
};

export interface ColumnMap {
  header: string;
  field: FieldKey | null;
}

/** 自动识别每一列表头对应的字段 */
export function detectMapping(headers: string[]): ColumnMap[] {
  const used = new Set<FieldKey>();
  return headers.map((h) => {
    const key = norm(h);
    for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [FieldKey, string[]][]) {
      if (!used.has(field) && aliases.some((a) => norm(a) === key)) {
        used.add(field);
        return { header: h, field };
      }
    }
    return { header: h, field: null };
  });
}

export interface ImportRow {
  assetNo?: string;
  name: string;
  spec?: string;
  category?: string;
  assetType?: "fixed" | "low";
  unit?: string;
  price?: number;
  total?: number;
  inUse?: number;
  loaned?: number;
  remark?: string;
  // 源 CSV 行号（用于错误提示）
  srcLine?: number;
}

const toInt = (s: string): number | undefined => {
  const t = s.trim().replace(/[，,、]/g, "");
  if (t === "") return undefined;
  const n = Number(t.replace(/[^\d.-]/g, ""));
  if (isNaN(n)) return undefined;
  return Math.max(0, Math.floor(n));
};

const toFloat = (s: string): number | undefined => {
  const t = s.trim().replace(/[，,]/g, "").replace(/[^\d.-]/g, "");
  if (t === "") return undefined;
  const n = Number(t);
  if (isNaN(n)) return undefined;
  return Math.max(0, n);
};

const clean = (s: string) => s.trim().replace(/^["']|["']$/g, "");

/** 将一行原始单元格按映射规范化为 ImportRow；返回 {row?, error?} */
export function normalizeRow(
  headers: string[],
  cells: string[],
  lineNo: number
): { row?: ImportRow; error?: string } {
  const map = detectMapping(headers);
  const get = (field: FieldKey): string => {
    const idx = map.findIndex((m) => m.field === field);
    return idx >= 0 ? clean(cells[idx] ?? "") : "";
  };
  const name = get("name");
  if (!name) return { error: `第 ${lineNo} 行缺少设备名称` };

  const totalS = get("total");
  const availS = get("available");
  const inUseS = get("inUse");
  const loanedS = get("loaned");

  const hasTotal = totalS !== "";
  const hasAvail = availS !== "";
  const hasInUse = inUseS !== "";
  const hasLoaned = loanedS !== "";

  let total = hasTotal ? toInt(totalS) : undefined;
  let inUse = hasInUse ? toInt(inUseS) : undefined;
  let loaned = hasLoaned ? toInt(loanedS) : undefined;

  // 数值缺失时：以“剩余数量/在用/借出”推算总数
  if (total === undefined) {
    if (hasAvail) total = toInt(availS);
    if (total === undefined) total = 0;
    if (inUse === undefined) inUse = 0;
    if (loaned === undefined) loaned = 0;
  } else {
    if (inUse === undefined) inUse = hasInUse ? undefined : 0;
    if (loaned === undefined) loaned = hasLoaned ? undefined : 0;
  }

  // 有“剩余数量”列时优先用它校正
  if (hasAvail) {
    const avail = toInt(availS);
    if (avail !== undefined) {
      if (inUse === undefined) inUse = 0;
      if (loaned === undefined) loaned = 0;
      // 剩余 = total - inUse - loaned；其中 inUse 未给时假设 0
      const used = Math.max(0, total - avail);
      if (loaned === undefined) loaned = 0;
      const inUseGuess = Math.max(0, used - loaned);
      if (!hasInUse) inUse = inUseGuess;
    }
  }
  if (inUse === undefined) inUse = 0;
  if (loaned === undefined) loaned = 0;

  // 数据一致性钳制：inUse + loaned <= total
  if (total < 0) total = 0;
  const cap = Math.max(0, total);
  inUse = Math.min(inUse, cap);
  loaned = Math.min(loaned, Math.max(0, cap - inUse));

  const row: ImportRow = {
    name,
    total,
    inUse,
    loaned,
  };
  const assetNo = get("assetNo");
  if (assetNo) row.assetNo = assetNo;
  const spec = get("spec");
  if (spec) row.spec = spec;
  const category = get("category");
  if (category) row.category = category;
  const assetType = get("assetType");
  if (/低值|low|易耗/i.test(assetType)) row.assetType = "low";
  else if (/固定|fixed/i.test(assetType)) row.assetType = "fixed";
  const unit = get("unit");
  if (unit) row.unit = unit;
  const price = toFloat(get("price"));
  if (price !== undefined) row.price = price;
  const remark = get("remark");
  if (remark) row.remark = remark;
  return { row };
}

export function downloadTextFile(name: string, content: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** 空模板 */
export const TEMPLATE_CSV = `资产编号,设备名称,规格型号,分类,资产类型,单位,单价,总数,在用,借出,剩余数量,备注
PHGD/DZ-5-2026-034,FDM 打印机,Bambu Lab P2S,3D 打印,固定资产,台,3699,1,0,0,1,
PHGD/DZ-9-2026-001,曲线锯,曲线锯,手动工具,低值物资,套,520,1,0,0,1,
,示波器,,测量仪器,固定资产,台,2599,2,0,0,2,无资产编号时按名称去重`;

export const SAMPLE_CSV = TEMPLATE_CSV;
