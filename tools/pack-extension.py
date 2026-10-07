#!/usr/bin/env python3
"""编译设置 schema，构建可重复的 GNOME 扩展安装包及 SHA-256 校验和。"""
import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOP_LEVEL = ('metadata.json', 'extension.js', 'prefs.js', 'stylesheet.css',
             'LICENSE', 'README.md', 'README.en.md', 'README.zh-CN.md')
DIRECTORIES = {
    'lib': {'.js'},
    'schemas': {'.xml', '.compiled'},
    'assets': {'.png', '.svg'},
    'docs': {'.md'},
    'locale': {'.mo'},
}
REQUIRED_DIRECTORIES = ('lib', 'schemas', 'assets')
ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


def payload(root):
    """明确列出允许打包的文件；拒绝符号链接，不将仓库、日志或测试输出打进去。"""
    files = {}

    def add(path):
        if path.is_symlink():
            raise ValueError(f'不允许打包符号链接：{path.relative_to(root)}')
        if not path.is_file():
            raise ValueError(f'缺少安装文件：{path.relative_to(root)}')
        files[path.relative_to(root).as_posix()] = path

    for name in TOP_LEVEL:
        add(root / name)
    for name, suffixes in DIRECTORIES.items():
        directory = root / name
        if directory.is_symlink():
            raise ValueError(f'不允许打包符号链接目录：{name}')
        if not directory.is_dir():
            if name in REQUIRED_DIRECTORIES:
                raise ValueError(f'缺少运行目录：{name}')
            continue
        for path in sorted(directory.rglob('*')):
            if path.is_symlink():
                raise ValueError(f'不允许打包符号链接：{path.relative_to(root)}')
            if path.is_file() and path.suffix in suffixes:
                add(path)
    return files


def build(root, output_dir, tag=None):
    root = Path(root).resolve()
    output_dir = Path(output_dir).resolve()
    files = payload(root)
    metadata = json.loads(files['metadata.json'].read_text(encoding='utf-8'))
    uuid = metadata.get('uuid', '')
    version = metadata.get('version-name', '')
    if not re.fullmatch(r'[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+', uuid):
        raise ValueError('metadata.json 的 uuid 不是合法扩展标识')
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?', version):
        raise ValueError('metadata.json 的 version-name 必须是语义版本号')
    if type(metadata.get('version')) is not int or metadata['version'] < 1:
        raise ValueError('metadata.json 的 version 必须是正整数')
    if tag is not None and tag != f'v{version}':
        raise ValueError(f'发布标签 {tag!r} 与 metadata.json 的 v{version} 不一致')
    for name in DIRECTORIES:
        if output_dir == root / name or root / name in output_dir.parents:
            raise ValueError('输出目录不能位于打包的源目录内')

    # 将编译后的 schema 一并交付，安装时不依赖目标用户再次编译。
    subprocess.run(['glib-compile-schemas', '--strict', str(root / 'schemas')], check=True)
    compiled = root / 'schemas' / 'gschemas.compiled'
    if not compiled.is_file() or compiled.is_symlink():
        raise ValueError('设置 schema 未正确编译')
    files['schemas/gschemas.compiled'] = compiled

    output_dir.mkdir(parents=True, exist_ok=True)
    archive = output_dir / f'{uuid}.shell-extension.zip'
    temporary = archive.with_suffix(archive.suffix + '.tmp')
    try:
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            for name, path in sorted(files.items()):
                info = zipfile.ZipInfo(name, ZIP_TIMESTAMP)
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | 0o644) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(info, path.read_bytes(), compresslevel=9)
        temporary.replace(archive)
    finally:
        temporary.unlink(missing_ok=True)
    checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
    (output_dir / 'SHA256SUMS').write_text(f'{checksum}  {archive.name}\n', encoding='ascii')
    return archive


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'dist')
    parser.add_argument('--tag', default=os.environ.get('RELEASE_TAG') or None,
                        help='发布标签；必须匹配 metadata.json 的 version-name')
    args = parser.parse_args()
    try:
        archive = build(ROOT, args.output_dir, args.tag)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'打包失败：{error}\n')
    print(archive)
    print(archive.parent / 'SHA256SUMS')


if __name__ == '__main__':
    main()
