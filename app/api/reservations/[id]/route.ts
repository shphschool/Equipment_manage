import { NextResponse } from "next/server";
import { actReservation, deleteReservation, type ReservationAction } from "@/lib/reservations";

type Ctx = { params: Promise<{ id: string }> };

const ACTIONS: ReservationAction[] = ["approve", "reject", "complete", "cancel"];

/** body: { action: "approve"|"reject"|"complete"|"cancel", reason?: string } */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    action?: ReservationAction;
    reason?: string;
  };
  if (!body.action || !ACTIONS.includes(body.action)) {
    return NextResponse.json({ error: "未知操作" }, { status: 400 });
  }

  const res = await actReservation(id, body.action, body.reason);
  if (!res.ok) {
    return NextResponse.json(
      { error: res.error, conflict: res.conflict ?? false },
      { status: res.conflict ? 409 : 400 }
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await deleteReservation(id);
  return NextResponse.json({ ok: true });
}
