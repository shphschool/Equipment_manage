# 开发与 AI 协作说明

本文记录本次科创教室资产管理 / 学生借用登记功能的实现过程、用到的 AI skill 以及待确认事项，便于后续交接。

## 一、本次完成的内容

1. 读取 `科创教室.xlsx` 的「固定资产」「低值」两个工作表，整理为 41 件资产：
   - 固定资产 13 件，沿用原「固定资产编号」；
   - 低值物资 28 件，按件拆分，逐件分配编号 `PHGD/DZ-9-2026-001 ~ 028`。
2. 将 41 件资产写入现有 Neon Postgres 的 `equipment` 表，每件 `total = 1`。
3. 设备台账新增资产编号、规格型号、资产类型、单位、单价等字段，并支持按资产编号搜索。
4. 将原「设备预约」统一改为「学生借用登记」（`/borrows`）：
   - 3D 打印机：姓名 + 班级 + 联系方式 + 可导入 Bambu Studio 的模型文件；
   - 其它固定资产：姓名 + 班级 + 联系方式 + 使用时间段；
   - 同一资产时间段冲突校验；
   - 待审核 → 已通过 → 已完成 / 已拒绝 / 已取消；
   - 模型文件存 Postgres `reservation_files`，支持下载。
5. 移除旧的低值物资借用页面与接口；旧地址 `/reservations` 自动跳转 `/borrows`。

## 二、用到的 AI skill

| Skill | 用途 |
| --- | --- |
| `office-xlsx` | 读取 `科创教室.xlsx`，生成「低值-逐件编号」「资产导入清单」「编号说明」工作表 |
| `image-reading` / `vision-analyze` | 检查网页截图、Excel 渲染结果和表单布局 |
| `load_workspace_dependencies` | 获取 Python + openpyxl / pandas 运行环境 |
| Next.js 16 内置文档 | 确认 App Router、Route Handler、proxy 请求体上限等用法 |

> 说明：以上 skill 的运行环境在 DSH（DeepSeek Harness）中，仓库内不复制 skill 实现，只记录名称与用途。

## 三、关键文件

- `scripts/build-manifest.py`：从原始 Excel 生成 `scripts/kc-assets.json`
- `scripts/build-numbered-workbook.py`：生成逐件编号工作簿
- `scripts/import-kc-assets.mjs`：按资产编号幂等导入数据库
- `lib/reservations.ts`：学生借用登记数据层（固定资产、附件 bytea）
- `app/borrows/page.tsx`：学生借用登记页面
- `app/api/reservations/`：借用登记接口（含附件上传 / 下载）
- `app/equipment/page.tsx`：设备台账
- `db/init.sql`：数据库结构参考

## 四、验证记录

- `npm run lint` 通过；
- `npm run build` 通过；
- 实测：41 件资产查询正常；时间段冲突返回 409；3D 打印文件上传 / 下载正常（含 12MB 文件）；表单提交与删除正常；
- 测试数据已清理，数据库保留 41 件资产、0 条测试借用记录。

## 五、待确认事项

- **打印负责人联系方式尚未确定**，本次先不实现；后续确定后可在「3D 打印服务」或「学生借用登记」页面补充展示。
- 大文件部署到 Vercel 时受 4.5MB 请求体限制；本地 / 自建 Node 环境上限 25MB。

## 六、老师反馈原话

> 现在是缺少一个和打印负责人的联系方式，但是这个我们也还没有确定，所以先放一下。
> 可以先 commit 一次。
> 如果用 AI 做的话，可以把各种 skill 和 markdown 文件也传一下。
