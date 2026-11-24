import { redirect } from "next/navigation";

/** 兼容旧链接：固定资产预约已统一命名为「学生借用登记」 */
export default function ReservationsRedirect() {
  redirect("/borrows");
}
