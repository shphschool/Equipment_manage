import { NextResponse } from "next/server";
import { getReservationFile } from "@/lib/reservations";

type Ctx = { params: Promise<{ id: string }> };

/** 下载借用登记附件（3D 打印模型文件） */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const file = await getReservationFile(id);
  if (!file) return NextResponse.json({ error: "附件不存在" }, { status: 404 });

  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mime || "application/octet-stream",
      "Content-Length": String(file.data.length),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
