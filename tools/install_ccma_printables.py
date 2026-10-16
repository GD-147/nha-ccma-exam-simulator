#!/usr/bin/env python3
"""Register the 35 CCMA PDFs and the Lena Whitmore logo in the existing portal.

Run from any directory using: python3 tools/install_ccma_printables.py
This preserves all configured exam sections, source JSONs and access settings.
"""
import json
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / 'packs' / 'nha-ccma'
CONFIG = PACK / 'config.json'
MANIFEST = ROOT / 'tools' / 'ccma_printables_manifest.json'
LOGO = PACK / 'assets' / 'logo.png'
PDF_DIR = PACK / 'pdf'
APP_HTML = ROOT / 'app' / 'app.html'
EXPECTED_LOGO_SHA256 = '6822cb7d5438917e857bc592da3bb29eb00bff9da9a08e213c7d99044fa4c7a3'

if __name__ == '__main__':
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    assert len(manifest) == 35, 'Expected 35 printables in manifest'
    filenames = [p['file'] for p in manifest]
    assert len(set(filenames)) == 35, 'Duplicate printable filename'
    assert filenames == [f'ccma_practice_exam_{i:02d}.pdf' for i in range(1, 36)], 'Incorrect PDF numbering'

    for entry in manifest:
        path = PDF_DIR / entry['file']
        assert path.is_file(), f'Missing PDF: {path}'
        assert path.read_bytes()[:5] == b'%PDF-', f'Invalid PDF: {path}'

    assert LOGO.is_file(), f'Missing logo: {LOGO}'
    logo_hash = hashlib.sha256(LOGO.read_bytes()).hexdigest()
    assert logo_hash == EXPECTED_LOGO_SHA256, 'Logo file does not match Lena Whitmore attachment'

    cfg = json.loads(CONFIG.read_text(encoding='utf-8'))
    assert cfg.get('examId') == 'nha-ccma', 'Wrong repository/configuration'
    assert len(cfg.get('sections', [])) == 8, 'Unexpected domain/Full-Length sections'
    assert len(cfg.get('examFiles', [])) == 5, 'Expected five master exams'
    assert all((PACK/'data'/name).is_file() for name in cfg['examFiles']), 'Missing master exam JSON'

    cfg['printables'] = manifest
    cfg['logoPath'] = '../packs/nha-ccma/assets/logo.png?v=lena-whitmore-20261016'
    CONFIG.write_text(json.dumps(cfg, ensure_ascii=False, indent=2)+'\n',encoding='utf-8')

    if APP_HTML.is_file():
        old='Use “Printable Practice Exams” to download PDFs when available.'
        new='Use “Printable Practice Exams” to download all 35 PDFs with answer keys and explanations.'
        html_content=APP_HTML.read_text(encoding='utf-8')
        if old in html_content:
            APP_HTML.write_text(html_content.replace(old,new),encoding='utf-8')
            print('PASS | Portal welcome text updated')
        elif new in html_content:
            print('PASS | Portal welcome text already updated')
        else:
            print('INFO | Welcome text unchanged (different portal wording)')

    print('PASS | 35 PDF files validated')
    print('PASS | Lena Whitmore logo validated, cache version changed')
    print('PASS | Existing five exams and eight sections preserved')
    print('PASS | config.json updated with 35 Printable Practice Exams')
    print('NO GIT PUSH')
