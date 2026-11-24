"""生成《科创教室-已编号.xlsx》：
- 保留原始 4 个工作表；
- 新增「低值-逐件编号」：低值物资按件展开，每件一个资产编号；
- 新增「资产导入清单」：固定资产 + 低值物资共 41 件；
- 新增「编号说明」。
"""

import json
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "科创教室.xlsx"
MANIFEST = ROOT / "scripts" / "kc-assets.json"
OUT = ROOT / "科创教室-已编号.xlsx"

HEADER_FILL = PatternFill("solid", fgColor="1E3A8A")
HEADER_FONT = Font(color="FFFFFF", bold=True, size=10)
TITLE_FONT = Font(bold=True, size=14, color="1E3A8A")
LOW_FILL = PatternFill("solid", fgColor="F1F5F9")
FIXED_FILL = PatternFill("solid", fgColor="EEF2FF")
THIN = Side(style="thin", color="D8DEE9")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def write_table(ws, headers, rows, widths=None, fill_by=None):
    ws.append(headers)
    for c in range(1, len(headers) + 1):
        cell = ws.cell(1, c)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = BORDER
    for r in rows:
        ws.append(r)
    for ri in range(2, ws.max_row + 1):
        for ci in range(1, len(headers) + 1):
            cell = ws.cell(ri, ci)
            cell.border = BORDER
            cell.alignment = Alignment(vertical="center", wrap_text=ci in (3, 4, 7))
        if fill_by:
            ws.row_dimensions[ri].fill = fill_by(ws, ri)
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(headers))}{ws.max_row}"
    if widths:
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(i)].width = w
    ws.row_dimensions[1].height = 28


def main():
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    assets = data["assets"]
    fixed = [a for a in assets if a["assetType"] == "fixed"]
    low = [a for a in assets if a["assetType"] == "low"]

    wb = load_workbook(SRC)
    for name in ("低值-逐件编号", "资产导入清单", "编号说明"):
        if name in wb.sheetnames:
            del wb[name]
    # 输出文件不携带发票信息，避免税号 / 发票号码等随资产清单流转
    if "发票基础信息" in wb.sheetnames:
        del wb["发票基础信息"]

    # 低值逐件编号
    ws_low = wb.create_sheet("低值-逐件编号")
    low_rows = []
    for i, a in enumerate(low, start=1):
        low_rows.append([
            i, a["assetNo"], a["name"], a["spec"], a["category"], a["unit"],
            1, a["price"], round(a["price"], 2), a["remark"],
        ])
    write_table(
        ws_low,
        ["序号", "资产编号", "物资名称", "规格型号", "分类", "单位", "数量", "单价（元）", "总价（元）", "备注"],
        low_rows,
        widths=[6, 22, 30, 34, 17, 6, 6, 11, 11, 18],
    )
    for ri in range(2, ws_low.max_row + 1):
        for ci in (1, 6, 7):
            ws_low.cell(ri, ci).alignment = Alignment(horizontal="center", vertical="center")
        ws_low.cell(ri, 8).number_format = "#,##0.00"
        ws_low.cell(ri, 9).number_format = "#,##0.00"
        if ri % 2 == 0:
            for ci in range(1, 11):
                ws_low.cell(ri, ci).fill = LOW_FILL

    # 总导入清单
    ws_all = wb.create_sheet("资产导入清单")
    all_rows = []
    for i, a in enumerate(fixed + low, start=1):
        all_rows.append([
            i,
            "固定资产" if a["assetType"] == "fixed" else "低值物资",
            a["assetNo"], a["name"], a["spec"], a["category"], a["unit"],
            1, a["price"], a["remark"],
        ])
    write_table(
        ws_all,
        ["序号", "资产类型", "资产编号", "资产名称", "规格型号", "分类", "单位", "数量", "单价（元）", "备注"],
        all_rows,
        widths=[6, 10, 22, 32, 38, 18, 6, 6, 11, 18],
    )
    for ri in range(2, ws_all.max_row + 1):
        for ci in (1, 2, 7, 8):
            ws_all.cell(ri, ci).alignment = Alignment(horizontal="center", vertical="center")
        ws_all.cell(ri, 9).number_format = "#,##0.00"
        for ci in range(1, 11):
            ws_all.cell(ri, ci).fill = FIXED_FILL if ws_all.cell(ri, 2).value == "固定资产" else LOW_FILL

    # 编号说明
    ws_note = wb.create_sheet("编号说明")
    ws_note["A1"] = "科创教室资产编号说明"
    ws_note["A1"].font = TITLE_FONT
    notes = [
        ("编号格式", "PHGD/{类别代码}-{分类号}-{年度}-{三位流水号}"),
        ("固定资产", "沿用原「固定资产」工作表中的「固定资产编号」，共 13 件，未作改动。"),
        ("低值物资", "原表同一品种有多件的，按件拆分为独立资产，每件一个编号：PHGD/DZ-9-2026-001 ~ PHGD/DZ-9-2026-028。"),
        ("低值类别代码", "DZ = 低值物资；9 为低值专用分类号；2026 为入账年度；001-028 为流水号。"),
        ("同型号多件", "按原表行顺序连续编号。例如 FX-888D 数显焊台 4 台为 005-008，集成可编程机器人 AIM 10 套为 015-024。"),
        ("数量", "逐件编号后，每行数量均为 1，便于单件预约、借出和盘点。"),
        ("固定资产分类", "按用途归类：电源仪器 / 无人机 / 测量仪器 / 开发套件 / 机器人 / 3D 打印 / 视觉设备 / 激光加工。"),
        ("导入结果", "以上 41 件资产已写入平台数据库；固定资产 13 件，低值物资 28 件。"),
        ("隐私说明", "输出文件未包含原「发票基础信息」工作表，避免发票号码 / 税号等信息随资产清单流转。"),
    ]
    ws_note["A3"] = "项目"
    ws_note["B3"] = "说明"
    for c in ("A3", "B3"):
        ws_note[c].fill = HEADER_FILL
        ws_note[c].font = HEADER_FONT
        ws_note[c].border = BORDER
    for i, (k, v) in enumerate(notes, start=4):
        ws_note.cell(i, 1, k).font = Font(bold=True, color="1E3A8A")
        ws_note.cell(i, 2, v)
        ws_note.cell(i, 1).border = BORDER
        ws_note.cell(i, 2).border = BORDER
        ws_note.cell(i, 2).alignment = Alignment(wrap_text=True, vertical="center")
    ws_note.column_dimensions["A"].width = 16
    ws_note.column_dimensions["B"].width = 90
    ws_note.freeze_panes = "A4"

    wb.save(OUT)
    print(f"已生成 {OUT}")
    print(f"固定资产 {len(fixed)} 件；低值物资 {len(low)} 件；合计 {len(assets)} 件")


if __name__ == "__main__":
    main()
