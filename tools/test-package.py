#!/usr/bin/env python3
"""不启动桌面的安装包回归：结构、校验和、可重复性及输入安全。"""
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('packer', ROOT / 'tools' / 'pack-extension.py')
packer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packer)


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='win11-package-')
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.source = self.directory / 'source'
        self.source.mkdir()
        for name in packer.TOP_LEVEL:
            shutil.copyfile(ROOT / name, self.source / name)
        for name in packer.DIRECTORIES:
            if (ROOT / name).is_dir():
                shutil.copytree(ROOT / name, self.source / name)
        self.version = json.loads((self.source / 'metadata.json').read_text())['version-name']

    def metadata(self, **values):
        path = self.source / 'metadata.json'
        data = json.loads(path.read_text())
        data.update(values)
        path.write_text(json.dumps(data))

    def build(self, name='out', tag=None):
        return packer.build(self.source, self.directory / name, tag)

    def test_installable_layout_and_bilingual_documents(self):
        archive = self.build()
        with zipfile.ZipFile(archive) as z:
            names = z.namelist()
            for required in ('metadata.json', 'extension.js', 'prefs.js', 'stylesheet.css',
                             'schemas/gschemas.compiled', 'lib/panel.js', 'assets/window-shadow.png',
                             'LICENSE', 'README.md', 'README.zh-CN.md'):
                self.assertIn(required, names)
            self.assertTrue(z.read('schemas/gschemas.compiled'))
            self.assertEqual(z.testzip(), None)
            self.assertEqual(names, sorted(names))
            self.assertTrue(all(not name.startswith(('/', '../', 'tools/', '.git/')) for name in names))
            self.assertTrue(all(not name.endswith(('.log', '.pyc', '.shell-extension.zip')) for name in names))
            self.assertEqual(json.loads(z.read('metadata.json'))['version-name'], self.version)

    def test_checksum_matches_archive(self):
        archive = self.build()
        digest, filename = (archive.parent / 'SHA256SUMS').read_text().split()
        self.assertEqual(filename, archive.name)
        self.assertEqual(digest, hashlib.sha256(archive.read_bytes()).hexdigest())

    def test_build_is_reproducible_despite_source_mtime(self):
        first = self.build('one').read_bytes()
        for path in self.source.rglob('*'):
            if path.is_file():
                os.utime(path, (1_000_000_000, 1_000_000_000))
        second = self.build('two').read_bytes()
        self.assertEqual(first, second)

    def test_tag_must_match_metadata(self):
        self.build(tag=f'v{self.version}')
        with self.assertRaisesRegex(ValueError, '不一致'):
            self.build('wrong', tag=f'v{self.version}-mismatch')

    def test_symlink_cannot_include_outside_file(self):
        outside = self.directory / 'outside.svg'
        outside.write_text('not an extension resource')
        (self.source / 'assets' / 'outside.svg').symlink_to(outside)
        with self.assertRaisesRegex(ValueError, '符号链接'):
            self.build()

    def test_invalid_metadata_and_output_path_are_rejected(self):
        for values in ({'uuid': '../../unsafe'}, {'version': True}, {'version-name': 'not-a-version'}):
            with self.subTest(values=values):
                original = (self.source / 'metadata.json').read_text()
                try:
                    self.metadata(**values)
                    with self.assertRaises(ValueError):
                        self.build()
                finally:
                    (self.source / 'metadata.json').write_text(original)
        with self.assertRaisesRegex(ValueError, '输出目录'):
            packer.build(self.source, self.source / 'assets' / 'build')

    def test_compiled_schema_is_readable_after_extracting(self):
        archive = self.build()
        extracted = self.directory / 'extracted'
        with zipfile.ZipFile(archive) as z:
            z.extractall(extracted)
        schema = json.loads((extracted / 'metadata.json').read_text())['settings-schema']
        result = subprocess.run(['gsettings', '--schemadir', str(extracted / 'schemas'), 'list-keys', schema],
                                capture_output=True, text=True, check=True,
                                env=dict(os.environ, GSETTINGS_BACKEND='memory'))
        self.assertIn('search-style', result.stdout.splitlines())
        self.assertIn('snap-layouts', result.stdout.splitlines())


if __name__ == '__main__':
    unittest.main(verbosity=2)
