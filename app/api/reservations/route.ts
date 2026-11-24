import { NextResponse } from "next/server";
import { addReservation, listReservations, type ReservationFileInput } from "@/lib/reservations";
import { MAX_RESERVATION_FILE_BYTES, isAllowedBambuFile } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await listReservations(), {
    headers: { "Cache-Control": "no-store" },
  });
}

function text(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  let body: Record<string, string> = {};
  let file: ReservationFileInput | undefined;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "表单数据格式不正确" }, { status: 400 });
    body = {
      student: text(form, "student"),
      className: text(form, "className"),
      phone: text(form, "phone"),
      equipmentId: text(form, "equipmentId"),
      startAt: text(form, "startAt"),
      endAt: text(form, "endAt"),
      purpose: text(form, "purpose"),
    };

    const raw = form.get("file");
    if (raw && typeof raw !== "string" && raw.size > 0) {
      if (!isAllowedBambuFile(raw.name)) {
        return NextResponse.json(
          { error: "文件格式不支持，请上传 .3mf / .stl / .obj / .step / .stp / .amf 文件" },
          { status: 400 }
        );
      }
      if (raw.size > MAX_RESERVATION_FILE_BYTES) {
        return NextResponse.json(
          { error: `文件不能超过 ${Math.floor(MAX_RESERVATION_FILE_BYTES / 1024 / 1024)}MB` },
          { status: 413 }
        );
      }
      const data = Buffer.from(await raw.arrayBuffer());
      file = {
        name: raw.name,
        mime: raw.type || "application/octet-stream",
        size: raw.size,
        data,
      };
    }
  } else {
    const json = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    body = {
      student: String(json.student ?? "").trim(),
      className: String(json.className ?? "").trim(),
      phone: String(json.phone ?? "").trim(),
      equipmentId: String(json.equipmentId ?? "").trim(),
      startAt: String(json.startAt ?? "").trim(),
      endAt: String(json.endAt ?? "").trim(),
      purpose: String(json.purpose ?? "").trim(),
    };
  }

  const res = await addReservation(
    {
      student: body.student,
      className: body.className,
      phone: body.phone,
      equipmentId: body.equipmentId,
      startAt: body.startAt || undefined,
      endAt: body.endAt || undefined,
      purpose: body.purpose,
    },
    file
  );

  if (!res.ok) {
    return NextResponse.json(
      { error: res.error, conflict: res.conflict ?? false },
      { status: res.conflict ? 409 : 400 }
    );
  }
  return NextResponse.json(res.reservation, { status: 201 });
}
