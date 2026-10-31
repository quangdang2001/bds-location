#!/usr/bin/env python3
"""Đọc data/BDS.xlsx (kèm hyperlink của từng ô) -> data/dataset.js

Google Sheets xuất CSV sẽ mất hyperlink, nên bảng gốc phải lấy từ .xlsx.
Chạy lại sau mỗi lần tải bảng mới:  python3 tools/embed.py
"""
import argparse, json, re, sys, zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {
    'm': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'p': 'http://schemas.openxmlformats.org/package/2006/relationships',
}
ROOT = Path(__file__).resolve().parent.parent

# Repo là public và dataset.js được build thẳng vào trang web, nên số điện
# thoại bị che theo mặc định. Dùng --keep-contacts khi build bản chỉ dùng
# ở máy mình.
CONTACT_COL = re.compile(r'contact|lien he|sdt|so dien thoai|dien thoai|phone|zalo', re.I)
PHONE = re.compile(r'(?<!\d)(0\d{1,2}[.\s-]?\d{3}[.\s-]?\d{3,4})(?!\d)')


def no_accent(s):
    import unicodedata
    return ''.join(c for c in unicodedata.normalize('NFD', s)
                   if unicodedata.category(c) != 'Mn').replace('đ', 'd').replace('Đ', 'D')


def mask(num: str) -> str:
    d = re.sub(r'\D', '', num)
    return f'{d[:3]} •••• {d[-2:]}' if len(d) >= 7 else '••••'


def redact(records):
    """Che mọi thứ trông giống số điện thoại, ở cột liên hệ lẫn trong ghi chú."""
    n = 0
    for rec in records:
        for k, v in list(rec.items()):
            if not isinstance(v, str) or not v:
                continue
            new = PHONE.sub(lambda m: mask(m.group(1)), v)
            if new == v and CONTACT_COL.search(no_accent(k)) and sum(c.isdigit() for c in v) >= 7:
                new = mask(v)                      # cột liên hệ, định dạng lạ
            if new != v:
                rec[k] = new
                n += 1
    return n
SRC  = ROOT / 'data' / 'BDS.xlsx'
OUT  = ROOT / 'data' / 'dataset.js'


def col_of(ref):            # "E3" -> "E"
    return re.match(r'([A-Z]+)', ref).group(1)


def row_of(ref):            # "E3" -> 3
    return int(re.search(r'(\d+)', ref).group(1))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--keep-contacts', action='store_true',
                    help='giữ nguyên số điện thoại (chỉ dùng cho bản chạy ở máy mình)')
    keep = ap.parse_args().keep_contacts

    if not SRC.exists():
        sys.exit(f'không thấy {SRC}')
    z = zipfile.ZipFile(SRC)

    shared = [
        ''.join(t.text or '' for t in si.iter(f'{{{NS["m"]}}}t'))
        for si in ET.fromstring(z.read('xl/sharedStrings.xml'))
    ] if 'xl/sharedStrings.xml' in z.namelist() else []

    sheet = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))

    # ô -> giá trị
    cells = {}
    for c in sheet.iter(f'{{{NS["m"]}}}c'):
        ref, t = c.get('r'), c.get('t')
        if t == 'inlineStr':
            val = ''.join(x.text or '' for x in c.iter(f'{{{NS["m"]}}}t'))
        else:
            v = c.find(f'{{{NS["m"]}}}v')
            val = '' if v is None or v.text is None else v.text
            if t == 's' and val != '':
                val = shared[int(val)]
        cells[ref] = val

    # ô -> hyperlink
    rels = {}
    rp = 'xl/worksheets/_rels/sheet1.xml.rels'
    if rp in z.namelist():
        for rel in ET.fromstring(z.read(rp)):
            rels[rel.get('Id')] = rel.get('Target')
    links = {}
    for h in sheet.iter(f'{{{NS["m"]}}}hyperlink'):
        tgt = rels.get(h.get(f'{{{NS["r"]}}}id')) or h.get('display') or ''
        for ref in (h.get('ref') or '').split():
            if ':' in ref:                       # vùng ô — lấy ô đầu
                ref = ref.split(':')[0]
            links[ref] = tgt

    if not cells:
        sys.exit('sheet rỗng')

    last = max(row_of(r) for r in cells)
    headers = {col_of(r): cells[r].strip() for r in cells
               if row_of(r) == 1 and cells[r].strip()}
    if not headers:
        sys.exit('không thấy dòng tiêu đề ở hàng 1')

    records = []
    for n in range(2, last + 1):
        rec = {}
        for col, name in headers.items():
            ref = f'{col}{n}'
            rec[name] = cells.get(ref, '')
            if ref in links:
                rec[f'{name} (link)'] = links[ref]
        if any(str(v).strip() for v in rec.values()):
            records.append(rec)

    hidden = 0 if keep else redact(records)

    fields = list(dict.fromkeys(headers.values()))
    for r in records:
        for f in r:
            if f not in fields:
                fields.append(f)

    OUT.write_text(
        '/* Sinh tự động từ data/BDS.xlsx bằng `python3 tools/embed.py` — đừng sửa tay.\n'
        '   Giữ cả hyperlink của từng ô dưới dạng cột "<Tên cột> (link)".\n' +
        ('' if keep else
         '   Số điện thoại đã được che. Chạy với --keep-contacts để sinh bản\n'
         '   đầy đủ cho máy mình; đừng commit bản đó.\n') +
        '*/\n'
        'window.__BDS_DATA = ' +
        json.dumps({'fields': fields, 'records': records}, ensure_ascii=False, indent=1) +
        ';\n', encoding='utf-8')
    print(f'{OUT.relative_to(ROOT)}: {len(records)} dòng, {len(fields)} cột, {len(links)} hyperlink'
          + ('' if keep else f', đã che {hidden} số điện thoại'))


if __name__ == '__main__':
    main()
