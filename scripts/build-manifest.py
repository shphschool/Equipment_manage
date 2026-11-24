import json
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "科创教室.xlsx"
OUT = ROOT / "scripts" / "kc-assets.json"
wb = load_workbook(SRC, data_only=True)

fixed_ws = wb["固定资产"]
low_ws = wb["低值"]

FIXED_CATS = {
    "可调直流电源": "电源仪器",
    "教育无人机": "无人机",
    "入门数字示波器": "测量仪器",
    "视觉开发学习套件": "开发套件",
    "竞赛机器人套件": "机器人",
    "FDM 打印机": "3D 打印",
    "双喷头打印机": "3D 打印",
    "深度相机": "视觉设备",
    "桌面激光切割机": "激光加工",
}

def s(v):
    if v is None:
        return ""
    return str(v).strip()

assets = []

# fixed assets: A3:H15
for r in range(3, 16):
    no = s(fixed_ws.cell(r, 2).value)
    if not no:
        continue
    name = s(fixed_ws.cell(r, 3).value)
    spec = s(fixed_ws.cell(r, 4).value)
    unit = s(fixed_ws.cell(r, 5).value) or "件"
    qty = int(float(fixed_ws.cell(r, 6).value or 0))
    price = float(fixed_ws.cell(r, 7).value or 0)
    remark = s(fixed_ws.cell(r, 8).value)
    assets.append({
        "assetNo": no,
        "name": name,
        "spec": spec,
        "category": FIXED_CATS.get(name, "固定资产"),
        "assetType": "fixed",
        "unit": unit,
        "price": round(price, 2),
        "quantity": qty,
        "remark": remark,
        "sourceSheet": "固定资产",
        "sourceRow": r,
    })

LOW_NAME = {
    "手动工具": lambda name, spec: spec,
    "除尘清洁": lambda name, spec: spec,
    "焊接": lambda name, spec: spec,
    "台虎钳": lambda name, spec: f"台虎钳 {spec}",
    "LiPo 安全充电": lambda name, spec: spec,
    "易燃品柜": lambda name, spec: spec,
    "集成可编程机器人": lambda name, spec: f"集成可编程机器人 {spec}",
    "3d打印干燥柜": lambda name, spec: "3D 打印耗材防潮箱",
    "万向吸风罩": lambda name, spec: f"万向吸风罩（{spec.replace('管径', '管径 ')}）",
    "焊接辅助": lambda name, spec: spec,
}

serial = 0
for r in range(3, 18):
    cat = s(low_ws.cell(r, 2).value)
    spec = s(low_ws.cell(r, 3).value)
    if not cat and not spec:
        continue
    unit = s(low_ws.cell(r, 4).value) or "件"
    qty = int(float(low_ws.cell(r, 5).value or 0))
    price = float(low_ws.cell(r, 6).value or 0)
    remark = s(low_ws.cell(r, 8).value)
    name = LOW_NAME.get(cat, lambda n, sp: sp if sp else n)(cat, spec)
    norm_cat = "3D 打印干燥柜" if cat == "3d打印干燥柜" else cat
    for i in range(1, qty + 1):
        serial += 1
        assets.append({
            "assetNo": f"PHGD/DZ-9-2026-{serial:03d}",
            "name": name,
            "spec": spec,
            "category": norm_cat,
            "assetType": "low",
            "unit": unit,
            "price": round(price, 2),
            "quantity": 1,
            "remark": (f"同型号第 {i}/{qty} 件" if qty > 1 else remark),
            "sourceSheet": "低值",
            "sourceRow": r,
        })

with open(OUT, "w", encoding="utf-8") as f:
    json.dump({
        "source": "科创教室.xlsx",
        "fixedCount": sum(1 for a in assets if a["assetType"] == "fixed"),
        "lowCount": sum(1 for a in assets if a["assetType"] == "low"),
        "assets": assets,
    }, f, ensure_ascii=False, indent=2)

print("total", len(assets), "fixed", sum(1 for a in assets if a['assetType']=='fixed'), "low", sum(1 for a in assets if a['assetType']=='low'))
for a in assets:
    print(a["assetNo"], "|", a["assetType"], "|", a["name"], "|", a["category"], "|", a["spec"], "|", a["unit"], a["price"], "|", a["remark"])
