#!/usr/bin/env python3
"""Gộp toàn bộ trang thành MỘT file HTML duy nhất.

Chạy lại sau mỗi lần sửa index.html, assets/* hoặc data/dataset.js:

    python3 tools/build.py              # -> docs/index.html
    python3 tools/build.py --out dist   # dùng trong GitHub Actions
"""
import argparse, base64, mimetypes, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# SheetJS (~880 KB) cố tình KHÔNG gộp vào: app.js tự nạp từ CDN khi
# người dùng mở file .xlsx, nên trang vẫn nhẹ.
SKIP = {'vendor/xlsx.full.min.js'}


def read(rel: str) -> str:
    p = ROOT / rel
    if not p.exists():
        sys.exit(f'thiếu {rel}')
    return p.read_text(encoding='utf-8')


def data_uri(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
    return f'data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}'


def inline_css_assets(css: str, base: Path) -> str:
    """url(images/layers.png) -> url(data:image/png;base64,...)"""
    def sub(m):
        ref = m.group(1).strip('\'"')
        if ref.startswith(('data:', 'http', '#')):
            return m.group(0)
        f = (base / ref).resolve()
        return f'url({data_uri(f)})' if f.exists() else m.group(0)
    return re.sub(r'url\(([^)]+)\)', sub, css)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--out', default='docs', help='thư mục xuất (mặc định: docs)')
    out = ROOT / ap.parse_args().out / 'index.html'

    html = read('index.html')

    # kiểm tra trên bản gốc, trước khi gộp — sau khi gộp thì chuỗi JS
    # cũng chứa src="..." nên không soi được nữa
    refs = [r for r in re.findall(r'(?:src|href)="([^"]+)"', html)
            if not r.startswith(('http', 'data:', '#'))]
    missing = [r for r in refs if not (ROOT / r).exists()]
    if missing:
        sys.exit('thiếu file: ' + ', '.join(missing))

    # <link rel=stylesheet href="..."> -> <style>
    def css_tag(m):
        href = m.group(1)
        if href.startswith('http'):
            return m.group(0)
        css = inline_css_assets(read(href), (ROOT / href).parent)
        return f'<style>\n/* {href} */\n{css}\n</style>'
    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', css_tag, html)

    # <script src="..."> -> <script>
    def js_tag(m):
        src = m.group(1)
        if src.startswith('http') or src in SKIP:
            return m.group(0)
        js = read(src)
        # </script> trong chuỗi JS sẽ đóng thẻ sớm
        js = js.replace('</script>', '<\\/script>')
        return f'<script>\n/* {src} */\n{js}\n</script>'
    html = re.sub(r'<script src="([^"]+)"></script>', js_tag, html)

    for r in refs:
        if r not in SKIP and f'"{r}"' in html:
            sys.exit(f'chưa gộp được: {r}')

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding='utf-8')
    print(f'{out}: {len(html.encode()) / 1024:.0f} KB — một file, không phụ thuộc file khác')


if __name__ == '__main__':
    main()
