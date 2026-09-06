import { NextResponse } from "next/server";
import { approveBorrow, deleteBorrow, rejectBorrow, returnBorrow, updateBorrow, type BorrowInput } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

/** body: { action?: "approve"|"reject"|"return", reason?, 或修改字段 } */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Partial<BorrowInput> & {
    action?: "approve" | "reject" | "return";
    reason?: string;
  };

  let res: { ok: boolean; error?: string } = { ok: true };
  if (body.action === "approve") res = await approveBorrow(id);
  else if (body.action === "reject") res = await rejectBorrow(id, body.reason);
  else if (body.action === "return") res = await returnBorrow(id);
  else {
    res = await updateBorrow(id, {
      student: String(body.student ?? ""),
      className: String(body.className ?? ""),
      equipmentId: String(body.equipmentId ?? ""),
      quantity: Number(body.quantity ?? 0),
      reason: body.reason ? String(body.reason) : undefined,
    });
  }
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await deleteBorrow(id);
  return NextResponse.json({ ok: true });
}
