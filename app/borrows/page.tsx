"use client";

// 学生借用登记：面向固定资产。
// 3D 打印机需上传可导入 Bambu Studio 的模型文件；其它设备需填写使用时间段。
// 底部数据层复用 lib/reservations.ts（原固定资产预约模块）。

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus, Search, Trash2, X, Check, CalendarClock, Clock, Printer,
  Phone, FileUp, CheckCircle2, RotateCcw, UserRound, Boxes,
} from "lucide-react";
import { api } from "@/lib/api";
import {
  is3DPrinter, isAllowedBambuFile, MAX_RESERVATION_FILE_BYTES,
  reservationStatusMeta, toView,
  type Equipment, type EquipmentView, type Reservation, type ReservationStatus,
} from "@/lib/types";
import { cx, fmtDate, fmtDateTime, relTime } from "@/lib/utils";
import {
  Btn, Badge, Card, Empty, Modal, Field, Input, Select, Textarea,
  ConfirmDialog, type ConfirmState, Th, Td,
} from "@/components/ui";
import { useToast } from "@/components/toast";

type TabKey = "all" | ReservationStatus;

const pad = (n: number) => String(n).padStart(2, "0");

function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultSlot(): { start: string; end: string } {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 2 * 3600 * 1000);
  return { start: toLocalInput(start), end: toLocalInput(end) };
}

function fmtTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtRange(start?: string, end?: string): string {
  if (!start || !end) return "—";
  if (fmtDate(start) === fmtDate(end)) return `${fmtDateTime(start)} – ${fmtTime(end)}`;
  return `${fmtDateTime(start)} – ${fmtDateTime(end)}`;
}

function fmtBytes(n?: number): string {
  if (!n || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function BorrowsPage() {
  const toast = useToast();
  const [items, setItems] = useState<Reservation[] | null>(null);
  const [eqs, setEqs] = useState<EquipmentView[]>([]);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<TabKey>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [presetId, setPresetId] = useState("");
  const [rejectFor, setRejectFor] = useState<Reservation | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Reservation | null>(null);

  const load = useCallback(async () => {
    const [rs, es] = await Promise.all([
      api.get<Reservation[]>("/api/reservations"),
      api.get<Equipment[]>("/api/equipment"),
    ]);
    setItems(rs);
    setEqs(es.map(toView));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch((e) => toast(e.message || "加载失败", "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // 从设备台账点击「借用」进入时自动打开表单并选中该资产
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("equipment") ?? "";
    if (id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPresetId(id);
      setFormOpen(true);
    }
  }, []);

  const counts = useMemo(() => {
    const rs = items ?? [];
    return {
      all: rs.length,
      pending: rs.filter((r) => r.status === "pending").length,
      approved: rs.filter((r) => r.status === "approved").length,
      completed: rs.filter((r) => r.status === "completed").length,
      rejected: rs.filter((r) => r.status === "rejected").length,
      cancelled: rs.filter((r) => r.status === "cancelled").length,
    };
  }, [items]);

  const today = fmtDate(new Date().toISOString());
  const todayCount = useMemo(
    () => (items ?? []).filter((r) => fmtDate(r.createdAt) === today).length,
    [items, today]
  );

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return (items ?? []).filter((r) => {
      if (tab !== "all" && r.status !== tab) return false;
      if (kw && !`${r.student} ${r.className} ${r.phone} ${r.equipmentName} ${r.assetNo} ${r.spec} ${r.purpose}`.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [items, q, tab]);

  const fixed = useMemo(() => eqs.filter((e) => e.assetType === "fixed"), [eqs]);

  const act = async (r: Reservation, action: "approve" | "reject" | "complete" | "cancel", reason?: string) => {
    try {
      await api.patch(`/api/reservations/${r.id}`, { action, reason });
      toast(
        action === "approve" ? `已通过 ${r.student} 的借用登记` :
        action === "reject" ? "已拒绝该借用登记" :
        action === "complete" ? "已标记完成" : "已取消该借用登记",
        "success"
      );
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "操作失败", "error");
    }
  };

  const doDelete = async (r: Reservation) => {
    try {
      await api.del(`/api/reservations/${r.id}`);
      toast("借用登记已删除", "success");
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "删除失败", "error");
    }
  };

  return (
    <div className="space-y-7">
      {/* 统计条 */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "待审核", value: counts.pending, icon: CalendarClock, cls: "text-amber-600", bg: "bg-amber-50 text-amber-500" },
          { label: "已通过", value: counts.approved, icon: CheckCircle2, cls: "text-sky-600", bg: "bg-sky-50 text-sky-500" },
          { label: "今日新增", value: todayCount, icon: Clock, cls: "text-violet-600", bg: "bg-violet-50 text-violet-500" },
          { label: "累计完成", value: counts.completed, icon: RotateCcw, cls: "text-emerald-600", bg: "bg-emerald-50 text-emerald-500" },
        ].map((c) => (
          <div key={c.label} className="flex items-center gap-4 rounded-2xl border border-slate-200/70 bg-white px-5 py-5 shadow-sm">
            <span className={cx("flex h-11 w-11 items-center justify-center rounded-xl", c.bg)}><c.icon size={19} /></span>
            <div>
              <p className={cx("tnum text-[24px] font-bold leading-none", c.cls)}>{c.value}</p>
              <p className="mt-1.5 text-xs text-slate-400">{c.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* 工具栏 */}
      <Card className="px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input placeholder="搜索姓名 / 班级 / 资产编号…" value={q} onChange={(e) => setQ(e.target.value)} className="h-10 pl-9 text-[13px]" />
          </div>
          <div className="ml-auto flex items-center gap-2.5">
            <Btn size="sm" icon={<Plus size={14} />} onClick={() => { setPresetId(""); setFormOpen(true); }}>新建借用</Btn>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {([
            { k: "all", label: "全部" },
            { k: "pending", label: "待审核" },
            { k: "approved", label: "已通过" },
            { k: "completed", label: "已完成" },
            { k: "rejected", label: "已拒绝" },
            { k: "cancelled", label: "已取消" },
          ] as { k: TabKey; label: string }[]).map((o) => {
            const active = tab === o.k;
            return (
              <button key={o.k} onClick={() => setTab(o.k)}
                className={cx(
                  "inline-flex h-8.5 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium transition",
                  active ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm shadow-indigo-500/30" : "bg-slate-100 text-slate-500 hover:bg-slate-200/70"
                )}>
                {o.label}
                <span className={cx("tnum rounded-full px-1.5 text-[10.5px]", active ? "bg-white/20" : "bg-white text-slate-400")}>
                  {counts[o.k]}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      {/* 借用登记表 */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px]">
            <thead className="bg-slate-50/80">
              <tr>
                <Th>借用人</Th>
                <Th>借用资产</Th>
                <Th>使用时间 / 打印文件</Th>
                <Th>用途说明</Th>
                <Th>申请时间</Th>
                <Th>状态</Th>
                <Th className="text-right">操作</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r) => {
                const badge = reservationStatusMeta[r.status];
                const active = r.status === "approved";
                return (
                  <tr key={r.id} className="transition hover:bg-indigo-50/30">
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-100 to-indigo-100 text-[13px] font-bold text-indigo-600">
                          {r.student.slice(0, 1)}
                        </span>
                        <div className="min-w-0">
                          <p className="text-[13.5px] font-semibold text-slate-800">{r.student}</p>
                          <p className="flex items-center gap-1 text-[11.5px] text-slate-400">
                            {r.className}
                            <span className="inline-flex items-center gap-0.5"><Phone size={9} />{r.phone}</span>
                          </p>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <p className="font-mono text-[11px] font-medium text-violet-600">{r.assetNo || "—"}</p>
                      <p className="text-[13px] font-medium text-slate-700">{r.equipmentName}</p>
                      {r.spec && <p className="max-w-[190px] truncate text-[11px] text-slate-400" title={r.spec}>{r.spec}</p>}
                    </Td>
                    <Td>
                      {r.is3DPrinter ? (
                        <div className="space-y-1">
                          <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-600">
                            <Printer size={10} /> 3D 打印
                          </span>
                          {r.fileName ? (
                            <a href={`/api/reservations/${r.id}/file`}
                              className="flex max-w-[210px] items-center gap-1 truncate text-[11.5px] font-medium text-indigo-600 hover:underline"
                              title={`下载 ${r.fileName}`}>
                              <FileUp size={11} className="shrink-0" />
                              <span className="truncate">{r.fileName}</span>
                            </a>
                          ) : (
                            <span className="text-[11px] text-rose-400">文件缺失</span>
                          )}
                          {r.fileSize ? <p className="tnum text-[10.5px] text-slate-400">{fmtBytes(r.fileSize)}</p> : null}
                        </div>
                      ) : (
                        <div>
                          <p className="tnum text-[12px] font-medium text-slate-700">{fmtRange(r.startAt, r.endAt)}</p>
                          <p className="text-[10.5px] text-slate-400">{r.startAt ? "使用时间段" : "—"}</p>
                        </div>
                      )}
                    </Td>
                    <Td className="max-w-[190px]">
                      <p className="truncate text-[12.5px] text-slate-500" title={r.purpose}>{r.purpose || <span className="text-slate-300">—</span>}</p>
                      {r.rejectReason && (
                        <p className="mt-0.5 truncate text-[11px] text-rose-400" title={r.rejectReason}>驳回：{r.rejectReason}</p>
                      )}
                    </Td>
                    <Td className="text-xs text-slate-400" title={fmtDateTime(r.createdAt)}>{relTime(r.createdAt)}</Td>
                    <Td>
                      <Badge meta={badge} pulse={r.status === "pending"} />
                      <div className="mt-1 space-y-0.5 text-[10.5px] leading-tight text-slate-400">
                        {r.reviewedAt && <p>审核 {fmtDateTime(r.reviewedAt)}</p>}
                        {r.closedAt && <p>结束 {fmtDateTime(r.closedAt)}</p>}
                      </div>
                    </Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {r.status === "pending" && (
                          <>
                            <Btn size="xs" variant="success" icon={<Check size={12} />} onClick={() => act(r, "approve")}>通过</Btn>
                            <Btn size="xs" variant="outline" className="text-rose-600 hover:border-rose-200 hover:bg-rose-50"
                              icon={<X size={12} />} onClick={() => setRejectFor(r)}>拒绝</Btn>
                          </>
                        )}
                        {active && (
                          <>
                            <Btn size="xs" variant="soft" icon={<CheckCircle2 size={12} />} onClick={() => act(r, "complete")}>完成</Btn>
                            <Btn size="xs" variant="ghost" icon={<X size={12} />} onClick={() => act(r, "cancel")}>取消</Btn>
                          </>
                        )}
                        <Btn size="xs" variant="ghost" className="text-slate-400 hover:text-rose-600" title="删除记录"
                          icon={<Trash2 size={13} />}
                          onClick={() => {
                            setPendingDelete(r);
                            setConfirm({
                              title: "删除借用登记", danger: true, yesText: "删除",
                              msg: <>确定删除 <b>{r.student}</b>（{r.className}）借用「{r.equipmentName}」的记录吗？</>,
                            });
                          }} />
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <Empty icon={<CalendarClock size={20} />} text={items?.length ? "没有符合条件的借用登记" : "还没有学生借用登记"}
              sub={items?.length ? undefined : "点击右上角「新建借用」登记，3D 打印机需上传 Bambu Studio 模型文件，其它设备需填写使用时间段"} />
          )}
        </div>
        <div className="border-t border-slate-100 px-5 py-3">
          <p className="text-[11.5px] text-slate-400">借用登记仅适用于固定资产；同一资产的时间段不可与待审核 / 已通过的借用登记重叠。</p>
        </div>
      </Card>

      <ReservationFormModal
        open={formOpen}
        fixed={fixed}
        presetId={presetId}
        onClose={() => { setFormOpen(false); setPresetId(""); }}
        onSaved={async () => { setFormOpen(false); setPresetId(""); await load(); }}
      />

      <RejectModal rec={rejectFor} onClose={() => setRejectFor(null)}
        onSubmit={async (reason) => {
          if (rejectFor) await act(rejectFor, "reject", reason);
          setRejectFor(null);
        }} />

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)}
        onYes={() => { if (pendingDelete) { doDelete(pendingDelete); setPendingDelete(null); } }} />
    </div>
  );
}

// ---------- 新建借用登记 ----------
function ReservationFormModal({ open, fixed, presetId, onClose, onSaved }: {
  open: boolean;
  fixed: EquipmentView[];
  presetId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [f, setF] = useState(() => {
    const slot = defaultSlot();
    return {
      student: "", className: "", phone: "", equipmentId: "",
      startAt: slot.start, endAt: slot.end, purpose: "",
    };
  });

  useEffect(() => {
    if (!open) return;
    const slot = defaultSlot();
    const firstId =
      presetId && fixed.some((e) => e.id === presetId)
        ? presetId
        : fixed[0]?.id ?? "";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setF({
      student: "", className: "", phone: "", equipmentId: firstId,
      startAt: slot.start, endAt: slot.end, purpose: "",
    });
    setFile(null);
    setFileError("");
  }, [open, presetId, fixed]);

  const pick = fixed.find((e) => e.id === f.equipmentId);
  const printer = pick ? is3DPrinter(pick) : false;

  const groups = useMemo(() => {
    const m = new Map<string, EquipmentView[]>();
    for (const e of fixed) {
      const arr = m.get(e.category) ?? [];
      arr.push(e);
      m.set(e.category, arr);
    }
    return [...m.entries()];
  }, [fixed]);

  const slotOk = !printer && !!f.startAt && !!f.endAt && new Date(f.endAt) > new Date(f.startAt);
  const canSave =
    !!f.student.trim() && !!f.className.trim() && !!f.phone.trim() && !!f.equipmentId &&
    (printer ? !!file && !fileError : slotOk);

  const onFile = (next: File | null) => {
    setFileError("");
    if (!next) { setFile(null); return; }
    if (!isAllowedBambuFile(next.name)) {
      setFile(null);
      setFileError("文件格式不支持，请上传 .3mf / .stl / .obj / .step / .stp / .amf");
      return;
    }
    if (next.size > MAX_RESERVATION_FILE_BYTES) {
      setFile(null);
      setFileError(`文件不能超过 ${Math.floor(MAX_RESERVATION_FILE_BYTES / 1024 / 1024)}MB`);
      return;
    }
    setFile(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("student", f.student);
      fd.append("className", f.className);
      fd.append("phone", f.phone);
      fd.append("equipmentId", f.equipmentId);
      fd.append("purpose", f.purpose);
      if (!printer) {
        fd.append("startAt", f.startAt ? new Date(f.startAt).toISOString() : "");
        fd.append("endAt", f.endAt ? new Date(f.endAt).toISOString() : "");
      }
      if (printer && file) fd.append("file", file);
      await api.postForm("/api/reservations", fd);
      toast(printer ? "3D 打印借用登记已提交，等待负责人审核" : "借用登记已提交，等待负责人审核", "success");
      await onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : "提交失败", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="学生借用登记" width="max-w-xl"
      icon={<CalendarClock size={17} />}
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>取消</Btn>
          <Btn disabled={!canSave || saving} onClick={save}>{saving ? "提交中…" : "提交借用"}</Btn>
        </>
      }>
      <div className="grid grid-cols-2 gap-4">
        <Field label="学生姓名" required>
          <Input value={f.student} placeholder="如：王小明" onChange={(e) => setF({ ...f, student: e.target.value })} />
        </Field>
        <Field label="班级" required>
          <Input value={f.className} placeholder="如：高二(3)班" onChange={(e) => setF({ ...f, className: e.target.value })} />
        </Field>
        <Field label="联系方式" required className="col-span-2" hint="手机号 / 微信，便于审核与交付通知">
          <Input value={f.phone} placeholder="如：13800000000" onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <Field label="借用资产" required className="col-span-2"
          hint={pick ? `${pick.assetNo} · 可借用` : "仅固定资产可借用"}>
          <Select value={f.equipmentId} onChange={(e) => setF({ ...f, equipmentId: e.target.value })}>
            {fixed.length === 0 && <option value="">暂无可借用的固定资产</option>}
            {groups.map(([cat, list]) => (
              <optgroup key={cat} label={cat}>
                {list.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}（{e.assetNo}）</option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>

        {pick && (
          <div className="col-span-2 flex items-start gap-2.5 rounded-xl border border-indigo-100 bg-indigo-50/60 px-3.5 py-2.5">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-indigo-500 ring-1 ring-indigo-100">
              {printer ? <Printer size={14} /> : <Boxes size={14} />}
            </span>
            <div className="min-w-0 text-[12px] leading-relaxed text-slate-600">
              <p className="font-semibold text-slate-800">{pick.name}</p>
              <p className="text-slate-500">{pick.spec || "—"} · {pick.category} · {pick.assetNo}</p>
            </div>
          </div>
        )}

        {printer ? (
          <Field label="Bambu Studio 模型文件" required className="col-span-2"
            hint=".3mf / .stl / .obj / .step / .stp / .amf，最大 25MB">
            <label className={cx(
              "flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-4 py-4 transition",
              file ? "border-emerald-300 bg-emerald-50/60" : "border-slate-200 bg-slate-50/60 hover:border-indigo-300 hover:bg-indigo-50/30"
            )}>
              <span className={cx(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1",
                file ? "bg-white text-emerald-500 ring-emerald-200" : "bg-white text-indigo-500 ring-slate-200"
              )}>
                <FileUp size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-slate-700">
                  {file ? file.name : "点击选择可导入 Bambu Studio 的文件"}
                </span>
                <span className="mt-0.5 block text-[11px] text-slate-400">
                  {file ? fmtBytes(file.size) : "3D 打印机借用登记必须上传模型文件，负责人将直接下载切片打印"}
                </span>
              </span>
              <input type="file" accept=".3mf,.stl,.obj,.step,.stp,.amf" className="hidden"
                onChange={(e) => { onFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
            </label>
            {fileError && <p className="mt-1.5 text-[11.5px] text-rose-500">{fileError}</p>}
          </Field>
        ) : (
          <>
            <Field label="使用开始时间" required>
              <Input type="datetime-local" value={f.startAt} onChange={(e) => setF({ ...f, startAt: e.target.value })} />
            </Field>
            <Field label="使用结束时间" required>
              <Input type="datetime-local" min={f.startAt} value={f.endAt} onChange={(e) => setF({ ...f, endAt: e.target.value })} />
            </Field>
          </>
        )}

        <Field label={printer ? "打印说明" : "用途说明"} className="col-span-2"
          hint={printer ? "选填，如材料 / 颜色 / 特殊要求" : "选填，便于负责人审核"}>
          <Textarea rows={2} value={f.purpose} placeholder={printer ? "如：PLA 黑色，0.2mm 层高，需要支撑" : "如：课堂展示、社团活动使用"}
            onChange={(e) => setF({ ...f, purpose: e.target.value })} />
        </Field>
      </div>

      {printer ? (
        <p className="mt-3.5 flex items-start gap-1.5 text-xs leading-relaxed text-slate-400">
          <Printer size={12} className="mt-0.5 shrink-0" />
          3D 打印机借用登记无需填写使用时间段；提交后由负责人审核文件并安排打印排期。
        </p>
      ) : (
        <p className={cx(
          "mt-3.5 flex items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-[12.5px]",
          !slotOk && f.startAt && f.endAt ? "border-rose-200 bg-rose-50 text-rose-600" : "border-slate-100 bg-slate-50/70 text-slate-500"
        )}>
          <Clock size={13} className="shrink-0" />
          {!slotOk && f.startAt && f.endAt
            ? "结束时间必须晚于开始时间"
            : "同一资产在该时间段内只能有一条待审核或已通过的借用登记。"}
        </p>
      )}
      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
        <UserRound size={11} /> 借用登记需填写学生姓名、班级和联系方式，提交后由设备负责人审核。
      </p>
    </Modal>
  );
}

// ---------- 拒绝原因 ----------
function RejectModal({ rec, onClose, onSubmit }: {
  rec: Reservation | null;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (rec) setReason(""); }, [rec]);
  return (
    <Modal open={!!rec} onClose={onClose} title="拒绝借用登记" width="max-w-md"
      icon={<X size={17} className="text-rose-500" />}
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>取消</Btn>
          <Btn variant="danger" onClick={() => onSubmit(reason)}>确认拒绝</Btn>
        </>
      }>
      <p className="text-sm leading-relaxed text-slate-600">
        将拒绝 <b className="text-slate-800">{rec?.student}</b>（{rec?.className}）借用「{rec?.equipmentName}」
        {rec?.is3DPrinter ? `，文件：${rec.fileName ?? "—"}` : `，时间：${fmtRange(rec?.startAt, rec?.endAt)}`}。
      </p>
      <Field label="拒绝原因（选填，将展示给学生）" className="mt-4">
        <Textarea rows={3} value={reason} placeholder="如：该时段设备已排课、模型超出打印尺寸等"
          onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
}
