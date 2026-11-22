"""术语库 Web 管理界面。单文件 Flask 应用，提供 REST API 和浏览器前端。"""

from __future__ import annotations

import argparse
import html
import importlib.util
import json
import os
import tempfile
import threading
import time
import webbrowser
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, request

app = Flask(__name__)


@app.after_request
def disable_cache(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# --- 全局状态 ---

GLOSSARY_PATH: str = ""
GLOSSARY_DIR: str = ""
SKILL_BASE: str = ""


def _validate_terms(terms) -> list[dict]:
    if not isinstance(terms, list):
        raise ValueError("glossary.json 顶层必须是术语对象数组")
    for index, term in enumerate(terms, 1):
        if not isinstance(term, dict):
            raise ValueError(f"第 {index} 条术语必须是 JSON 对象")
        if not term.get("term_id") or not term.get("en") or not term.get("cn"):
            raise ValueError(
                f"第 {index} 条术语必须包含非空 term_id、en 和 cn"
            )
    return terms


def _load_terms() -> list[dict]:
    with open(GLOSSARY_PATH, "r", encoding="utf-8") as f:
        return _validate_terms(json.load(f))


def _atomic_json_dump(terms: list[dict]) -> None:
    destination = Path(GLOSSARY_PATH)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.",
        suffix=".tmp",
        dir=destination.parent,
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(terms, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, destination)
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def _save_terms(terms: list[dict]) -> str | None:
    """保存术语：验证、排序、连续编号、原子写入、导出后清理旧 Excel。"""
    _validate_terms(terms)

    # 0. 按 en 字母排序、再按 cn 排序后重新连续分配 idx
    terms.sort(key=lambda t: (t.get("en", "").lower(), t.get("cn", "").lower()))
    for i, t in enumerate(terms, 1):
        t["idx"] = i

    # 1. 原子写入 JSON
    _atomic_json_dump(terms)

    # 2. 导出新 Excel
    try:
        export_path = os.path.join(
            SKILL_BASE,
            "scripts",
            "glossary_export.py",
        )
        spec = importlib.util.spec_from_file_location(
            "glossary_export",
            export_path,
        )
        if spec is None or spec.loader is None:
            raise RuntimeError(f"无法加载导出脚本: {export_path}")
        export_mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(export_mod)
        exported_path = Path(
            export_mod.export_to_excel(GLOSSARY_PATH, GLOSSARY_DIR)
        ).resolve()
    except (ImportError, OSError, RuntimeError, ValueError) as exc:
        return f"JSON 已完成，Excel 待完成：{exc}"

    # 3. 新导出成功后再删除旧 Excel
    for candidate in Path(GLOSSARY_DIR).glob("glossary_*.xlsx"):
        if candidate.resolve() != exported_path:
            candidate.unlink()
    return None


# 字段中文标签映射
_FIELD_LABELS = {
    "cn": "中文", "pos": "词性", "field": "子领域", "source": "来源",
    "examples": "示例",
}

# 字段值到中文的映射（用于显示）
_FIELD_VALUE_MAP = {}


def _val_display(key: str, val) -> str:
    """将字段值转为可读的中文显示。"""
    if key in _FIELD_VALUE_MAP and val in _FIELD_VALUE_MAP[key]:
        return str(_FIELD_VALUE_MAP[key][val])
    if isinstance(val, bool):
        return "是" if val else "否"
    if isinstance(val, list):
        return "; ".join(str(v) for v in val) if val else "(空)"
    if key == "field" and isinstance(val, str) and "/" in val:
        return val  # 多标签保留原样
    if val is None or val == "":
        return "(空)"
    return str(val)


def _normalize_field(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value).replace(",", "/")
    return [part.strip() for part in text.split("/") if part.strip()]


def _safe_log_html(value) -> str:
    """只允许日志内部使用的 ``<br>`` 分隔符，其余内容全部转义。"""
    normalized = (
        str(value)
        .replace("\r\n", "\n")
        .replace("\r", "\n")
        .replace("\n", "<br>")
    )
    parts = normalized.split("<br>")
    return "<br>".join(
        html.escape(html.unescape(part), quote=True)
        for part in parts
    )


def _log_change(term: dict, change_type: str):
    """将修改记录写入 Markdown 日志文件。"""
    log_path = os.path.join(GLOSSARY_DIR, "修改记录.md")
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # 确保文件存在且有表头
    if not os.path.isfile(log_path):
        with open(log_path, "w", encoding="utf-8") as f:
            f.write("# 修改记录\n\n")
            f.write("| 序号 | 时间 | 操作 | 术语 (en) | 修改详情 |\n")
            f.write("|------|------|------|-----------|----------|\n")

    en = _safe_log_html(term.get("en", "")).replace("|", "&#124;")
    idx = term.get("idx", "")
    detail = "—"

    if change_type == "新增":
        cn = _safe_log_html(term.get("cn", "")).replace("|", "&#124;")
        detail = f"新增: {en} → {cn}"
    elif change_type == "覆盖":
        detail = f"覆盖更新"
    elif change_type == "删除":
        detail = f"已删除"
    elif change_type == "修改" and isinstance(term.get("_changed"), dict):
        changed = term["_changed"]
        if not changed:
            # 没有实际的字段变更，跳过记录
            del term["_changed"]
            return
        lines = []
        for field, vals in changed.items():
            label = _FIELD_LABELS.get(field, field)
            old_disp = _safe_log_html(
                _val_display(field, vals["old"])
            ).replace("|", "&#124;")
            new_disp = _safe_log_html(
                _val_display(field, vals["new"])
            ).replace("|", "&#124;")
            lines.append(f"{label}：{old_disp} → {new_disp}")
        detail = "<br>".join(lines)
        del term["_changed"]

    with open(log_path, "a", encoding="utf-8") as f:
        f.write(f"| {idx} | {now} | {change_type} | {en} | {detail} |\n")


def configure(
    glossary_path: str | os.PathLike[str],
    skill_base: str | os.PathLike[str] | None = None,
) -> Path:
    """配置应用路径并验证术语库和导出脚本。"""
    global GLOSSARY_PATH, GLOSSARY_DIR, SKILL_BASE

    glossary = Path(glossary_path).expanduser().resolve()
    if not glossary.is_file():
        raise FileNotFoundError(f"{glossary} 不存在或不是文件")
    package_root = (
        Path(skill_base).expanduser().resolve()
        if skill_base
        else Path(__file__).resolve().parents[1]
    )
    export_script = package_root / "scripts" / "glossary_export.py"
    if not export_script.is_file():
        raise FileNotFoundError(f"缺少导出脚本: {export_script}")

    GLOSSARY_PATH = str(glossary)
    GLOSSARY_DIR = str(glossary.parent)
    SKILL_BASE = str(package_root)
    _load_terms()
    return glossary


# --- REST API ---


@app.route("/")
def index():
    return serve_frontend()


@app.route("/api/terms")
def list_terms():
    """搜索：?q=xxx 前缀匹配 en/cn。q 为空时返回全部术语。"""
    q = request.args.get("q", "").strip()
    terms = _load_terms()

    if q:
        q_lower = q.lower()
        results = []
        # "#" 特殊处理：搜索所有非字母开头的术语
        if q == "#":
            for t in terms:
                en = t.get("en", "")
                if en and not en[0].isalpha():
                    results.append(t)
        else:
            for t in terms:
                en = t.get("en", "")
                cn = t.get("cn", "")
                if en.lower().startswith(q_lower) or cn.startswith(q):
                    results.append(t)
    else:
        results = terms

    # 按英文术语字母排序
    results.sort(key=lambda t: t.get("en", "").lower())

    items = []
    for i, t in enumerate(results, 1):
        items.append({
            "idx": t.get("idx", i),
            "term_id": t.get("term_id", ""),
            "en": t.get("en", ""),
            "cn": t.get("cn", ""),
            "field": t.get("field", ""),
            "source": t.get("source", ""),
        })
    return jsonify({"terms": items, "total": len(items)})


@app.route("/api/stats")
def get_stats():
    """返回术语库统计：总数、来源列表、各首字母术语数"""
    terms = _load_terms()
    sources = list(dict.fromkeys(t.get("source", "") for t in terms if t.get("source", "").strip()))
    letters = {}
    for t in terms:
        en = t.get("en", "").strip()
        fc = en[0] if en else ""
        if fc and fc.isalpha():
            # 希腊字母用小写显示，拉丁字母用大写
            if 'Ͱ' <= fc <= 'Ͽ' or 'ἀ' <= fc <= '῿':
                ch = fc.lower()
            else:
                ch = fc.upper()
        else:
            ch = "#"
        letters[ch] = letters.get(ch, 0) + 1
    # 按字母顺序排列，# 放最后
    sorted_letters = sorted([(k, v) for k, v in letters.items() if k != "#"], key=lambda x: x[0])
    if "#" in letters:
        sorted_letters.append(("#", letters["#"]))
    return jsonify({
        "total": len(terms),
        "sources": sources,
        "letters": [{"letter": k, "count": v} for k, v in sorted_letters],
    })


@app.route("/api/recent-changes")
def recent_changes():
    """返回最近 5 条修改记录。"""
    log_path = os.path.join(GLOSSARY_DIR, "修改记录.md")
    if not os.path.isfile(log_path):
        return jsonify({"changes": []})
    with open(log_path, "r", encoding="utf-8") as f:
        lines = f.readlines()
    # 跳过表头（前 4 行），取最后 5 条数据行
    data_lines = [l for l in lines if l.startswith("|") and l.count("|") >= 6]
    recent = data_lines[-5:]
    changes = []
    for line in recent:
        parts = [p.strip() for p in line.split("|")[1:-1]]
        if len(parts) >= 5:
            changes.append({
                "idx": parts[0],
                "time": parts[1],
                "action": parts[2],
                "en": parts[3],
                "detail": _safe_log_html(parts[4]),
            })
    return jsonify({"changes": changes})


@app.route("/api/terms/<path:term_id>")
def get_term(term_id: str):
    terms = _load_terms()
    for t in terms:
        if t.get("term_id") == term_id:
            return jsonify(t)
    return jsonify({"error": "术语不存在"}), 404


@app.route("/api/terms", methods=["POST"])
def create_term():
    data = request.get_json(force=True)
    en = data.get("en", "").strip()
    cn = data.get("cn", "").strip()
    if not en or not cn:
        return jsonify({"error": "英文(en)和中文(cn)为必填项"}), 400

    terms = _load_terms()
    term_id = en.lower()

    existing = None
    for t in terms:
        if t.get("term_id") == term_id:
            existing = t
            break

    if existing:
        if not data.get("force"):
            return jsonify({"error": f"术语 '{en}' 已存在", "existing": existing}), 409
        existing["cn"] = cn
        existing["pos"] = data.get("pos", existing.get("pos", ""))
        existing["field"] = _normalize_field(
            data.get("field", existing.get("field", []))
        )
        existing["source"] = data.get("source", existing.get("source", ""))
        existing["updated_at"] = datetime.now().strftime("%Y-%m-%d")
        _log_change(existing, "覆盖")
        warning = _save_terms(terms)
        payload = {"message": "术语已覆盖更新", "term": existing}
        if warning:
            payload["warning"] = warning
        return jsonify(payload)

    now = datetime.now().strftime("%Y-%m-%d")
    new_term = {
        "term_id": term_id, "en": en, "cn": cn,
        "idx": 0,
        "pos": data.get("pos", ""),
        "field": _normalize_field(data.get("field", [])),
        "source": data.get("source", ""),
        "examples": data.get("examples", []), "created_at": now, "updated_at": now,
    }
    terms.append(new_term)
    warning = _save_terms(terms)  # _save_terms 会给 new_term 分配正确的 idx
    _log_change(new_term, "新增")
    payload = {"message": "术语已创建", "term": new_term}
    if warning:
        payload["warning"] = warning
    return jsonify(payload), 201


@app.route("/api/terms/<path:term_id>", methods=["PUT"])
def update_term(term_id: str):
    data = request.get_json(force=True)
    terms = _load_terms()
    for t in terms:
        if t.get("term_id") == term_id:
            changed = {}
            fields = ["cn", "pos", "field", "source", "examples"]
            for field in fields:
                if field in data:
                    old_val = t.get(field)
                    new_val = data[field]
                    if field == "field":
                        new_val = _normalize_field(new_val)
                    if old_val != new_val:
                        changed[field] = {"old": old_val, "new": new_val}
                    t[field] = new_val
            t["updated_at"] = datetime.now().strftime("%Y-%m-%d")
            t["_changed"] = changed
            _log_change(t, "修改")
            warning = _save_terms(terms)
            payload = {
                "message": "术语已更新",
                "changed": changed,
                "term": t,
            }
            if warning:
                payload["warning"] = warning
            return jsonify(payload)
    return jsonify({"error": "术语不存在"}), 404


@app.route("/api/shutdown", methods=["POST"])
def shutdown():
    shutdown_server = request.environ.get("werkzeug.server.shutdown")
    if not callable(shutdown_server):
        return jsonify({
            "error": "当前服务器不支持远程关闭，请在启动终端按 Ctrl+C。"
        }), 501
    shutdown_server()
    return jsonify({"message": "服务正在关闭。"})


@app.route("/api/terms/<path:term_id>", methods=["DELETE"])
def delete_term(term_id: str):
    terms = _load_terms()
    for i, t in enumerate(terms):
        if t.get("term_id") == term_id:
            deleted = terms.pop(i)
            _log_change(deleted, "删除")
            warning = _save_terms(terms)
            payload = {"message": "术语已删除", "term": deleted}
            if warning:
                payload["warning"] = warning
            return jsonify(payload)
    return jsonify({"error": "术语不存在"}), 404


# --- 前端 HTML（内嵌） ---

def serve_frontend() -> str:
    return r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>术语库管理</title>
<style>
/* ===== 设计系统 =====
   灵感：朱砂印 — 墨色为骨，朱红点睛
   ======================================== */
:root {
  --bg: #fcfcf9;
  --surface: #ffffff;
  --text: #1c1c1c;
  --text-secondary: #5f5f5f;
  --text-tertiary: #999999;
  --border: #e8e5e0;
  --accent: #b91c1c;
  --accent-hover: #991b1b;
  --accent-light: #fef2f2;
  --accent-wash: rgba(185, 28, 28, 0.06);
  --danger: #b91c1c;
  --success: #0d9488;
  --success-light: #f0fdfa;
  --overlay: rgba(20, 20, 20, 0.45);
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.03);
  --shadow-md: 0 2px 12px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.03);
  --shadow-lg: 0 12px 32px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.04);
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --font-en: "Times New Roman", Georgia, "Noto Serif SC", serif;
  --font-zh: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-display: Georgia, "Noto Serif SC", "SimSun", serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #141416;
    --surface: #1e1e22;
    --text: #e7e7e8;
    --text-secondary: #a0a0a8;
    --text-tertiary: #6b6b74;
    --border: #2e2e36;
    --accent: #ef4444;
    --accent-hover: #dc2626;
    --accent-light: #2d1b1b;
    --accent-wash: rgba(239,68,68,0.06);
    --overlay: rgba(0,0,0,0.65);
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.2);
    --shadow-md: 0 2px 12px rgba(0,0,0,0.3);
    --shadow-lg: 0 12px 32px rgba(0,0,0,0.4);
  }
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--font-zh);
  background: var(--bg); color: var(--text); min-height: 100vh;
  -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
  line-height: 1.6;
}
.container { max-width: 760px; margin: 0 auto; padding: 48px 24px; }

/* ===== 头部 ===== */
.header {
  display: flex; justify-content: space-between; align-items: flex-start;
  margin-bottom: 36px; padding-bottom: 24px;
  border-bottom: 1px solid var(--border);
}
.header-left h1 {
  font-family: var(--font-display);
  font-size: 28px; font-weight: 700; letter-spacing: 0.02em;
  color: var(--text); margin-bottom: 4px;
}
.header-left h1 em { font-style: normal; color: var(--accent); }
.header-left .subtitle {
  font-size: 13px; color: var(--text-tertiary); font-weight: 400;
}
.btn-shutdown {
  padding: 6px 16px; border: 1.5px solid var(--accent); border-radius: var(--radius-sm);
  font-size: 12px; cursor: pointer; background: var(--accent); color: #fff;
  font-weight: 600; transition: all 0.2s; white-space: nowrap; line-height: 1.5;
}
.btn-shutdown:hover { background: var(--accent-hover); border-color: var(--accent-hover); }

/* ===== 搜索框 ===== */
.search-wrapper { position: relative; margin-bottom: 0; }
.search-wrapper input {
  width: 100%; padding: 14px 52px 14px 18px;
  border: 1.5px solid var(--border); border-radius: var(--radius-md);
  font-size: 15px; background: var(--surface); color: var(--text);
  outline: none; transition: all 0.2s ease;
  font-family: var(--font-en); box-shadow: var(--shadow-sm);
}
.search-wrapper input::placeholder { color: var(--text-tertiary); font-weight: 400; font-family: var(--font-zh); }
.search-wrapper input:focus {
  border-color: var(--accent);
  box-shadow: var(--shadow-sm), 0 0 0 3px var(--accent-wash);
}
.search-wrapper .search-icon {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
  font-size: 17px; color: var(--text-tertiary); pointer-events: none;
  transition: color 0.2s;
}
.search-wrapper input:focus ~ .search-icon { color: var(--accent); }
.search-clear {
  position: absolute; right: 36px; top: 50%; transform: translateY(-50%);
  background: none; border: none; font-size: 18px; cursor: pointer;
  color: var(--text-tertiary); line-height: 1; padding: 4px;
  display: none; border-radius: 50%; width: 22px; height: 22px;
  align-items: center; justify-content: center;
}
.search-clear:hover { color: var(--text); background: var(--border); }
.search-clear.visible { display: flex; }

/* ===== 统计栏 ===== */
.stats-bar {
  padding: 16px 0; margin-bottom: 20px;
  font-size: 13px; color: var(--text-secondary);
}
.stats-bar .stat-row {
  display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: baseline;
  margin-bottom: 12px;
}
.stats-bar .stat-item { display: flex; align-items: baseline; gap: 4px; white-space: nowrap; }
.stats-bar .stat-num { font-size: 22px; font-weight: 700; color: var(--text); line-height: 1; font-family: var(--font-en); }
.stats-bar .stat-label { font-weight: 500; color: var(--text-secondary); font-size: 13px; }
/* 字母网格 */
.stats-bar .letter-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 4px;
}
.stats-bar .letter-tag {
  display: flex; align-items: baseline; gap: 2px;
  padding: 5px 8px; border-radius: var(--radius-sm);
  background: var(--accent-wash);
  font-family: var(--font-en); font-size: 14px; font-weight: 600;
  cursor: default; transition: background 0.12s;
  color: var(--text);
}
.stats-bar .letter-tag .l { font-family: var(--font-en); }
.stats-bar .letter-tag .c { font-size: 11px; color: var(--text-tertiary); font-weight: 400; margin-left: 1px; }
.stats-bar .letter-tag:hover { background: var(--accent); color: #fff; }
.stats-bar .letter-tag:hover .c { color: rgba(255,255,255,0.7); }

/* ===== 建议下拉 ===== */
.suggestions {
  display: none; position: absolute; left: 0; right: 0; top: calc(100% + 4px);
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-md); box-shadow: var(--shadow-lg);
  max-height: 380px; overflow-y: auto; z-index: 100;
}
.suggestions.active { display: block; animation: fadeIn 0.12s ease; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
.suggestion-item {
  display: flex; align-items: center; gap: 11px;
  padding: 10px 16px; cursor: pointer;
  transition: background 0.1s;
}
.suggestion-item:first-child { border-radius: var(--radius-md) var(--radius-md) 0 0; }
.suggestion-item:last-child { border-radius: 0 0 var(--radius-md) var(--radius-md); }
.suggestion-item:hover { background: var(--accent-wash); }
.suggestion-item .idx {
  width: 24px; height: 24px; display: flex; align-items: center;
  justify-content: center; background: var(--bg);
  border-radius: 4px; font-size: 11px; font-weight: 600;
  color: var(--text-tertiary); flex-shrink: 0; font-family: var(--font-en);
}
.suggestion-item .en {
  font-weight: 600; flex-shrink: 0; min-width: 130px;
  font-size: 14px; letter-spacing: -0.01em; font-family: var(--font-en);
}
.suggestion-item .sep { color: var(--text-tertiary); flex-shrink: 0; font-size: 12px; font-weight: 300; }
.suggestion-item .cn { color: var(--text-secondary); flex: 1; font-size: 14px; }
.suggestion-item .field-badge {
  font-size: 10px; padding: 2px 7px; border-radius: 10px;
  background: var(--accent-wash); color: var(--accent); flex-shrink: 0;
  font-weight: 500; letter-spacing: 0.02em;
}
.no-results {
  padding: 36px 16px; text-align: center; color: var(--text-tertiary); font-size: 14px;
}

/* ===== 最近修改 ===== */
.recent-changes {
  margin-top: 20px; padding: 16px 20px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-md); box-shadow: var(--shadow-sm);
}
.recent-changes h3 {
  font-size: 13px; font-weight: 600; color: var(--text-secondary);
  margin-bottom: 10px; letter-spacing: 0.03em;
}
.recent-changes .recent-item {
  display: flex; gap: 10px; align-items: baseline;
  padding: 5px 0; font-size: 13px; border-bottom: 1px solid var(--border);
}
.recent-changes .recent-item:last-child { border-bottom: none; }
.recent-changes .recent-time {
  color: var(--text-tertiary); font-size: 11px; white-space: nowrap; min-width: 42px;
}
.recent-changes .recent-action {
  font-weight: 600; font-size: 11px; white-space: nowrap;
  padding: 1px 6px; border-radius: 3px;
}
.recent-changes .recent-action.add { background: #d1fae5; color: #065f46; }
.recent-changes .recent-action.edit { background: #dbeafe; color: #1e40af; }
.recent-changes .recent-action.delete { background: #fee2e2; color: #991b1b; }
.recent-changes .recent-detail { color: var(--text-secondary); flex: 1; }
.actions { display: flex; gap: 10px; margin-bottom: 24px; justify-content: center; }
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  padding: 10px 28px; border: 1.5px solid var(--border); border-radius: var(--radius-sm);
  font-size: 14px; cursor: pointer; font-weight: 600; font-family: var(--font-zh);
  transition: all 0.15s; white-space: nowrap; background: var(--surface);
  color: var(--text); letter-spacing: -0.01em;
}
.btn:hover { border-color: var(--text-tertiary); }
.btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
.btn-danger { background: var(--danger); color: #fff; border-color: var(--danger); }
.btn-danger:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
.btn-secondary { background: none; color: var(--text-secondary); border-color: var(--border); }
.btn-secondary:hover { background: var(--bg); color: var(--text); }
.btn-sm { padding: 6px 14px; font-size: 12px; }

/* ===== 弹窗通用 ===== */
.overlay {
  display: none; position: fixed; inset: 0; background: var(--overlay);
  z-index: 999; align-items: center; justify-content: center;
  backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);
}
.overlay.active { display: flex; animation: fadeIn 0.15s ease; }
.modal {
  background: var(--surface); border-radius: var(--radius-lg);
  padding: 32px; max-width: 600px; width: 92%; max-height: 85vh;
  overflow-y: auto; box-shadow: var(--shadow-lg);
  position: relative; animation: slideUp 0.2s ease;
}
@keyframes slideUp { from { opacity: 0; transform: translateY(12px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
.modal h2 {
  font-size: 18px; margin-bottom: 20px; font-weight: 700;
  font-family: var(--font-display); letter-spacing: 0.01em;
  padding-bottom: 12px; border-bottom: 1px solid var(--border);
}
.modal-close {
  position: absolute; top: 14px; right: 14px; background: none;
  border: none; font-size: 22px; cursor: pointer; color: var(--text-tertiary);
  width: 30px; height: 30px; display: flex; align-items: center;
  justify-content: center; border-radius: 50%; transition: all 0.15s;
  line-height: 1;
}
.modal-close:hover { background: var(--bg); color: var(--text); }

/* ===== 表单 ===== */
.field-group { margin-bottom: 16px; }
.field-group label {
  display: block; font-size: 11px; font-weight: 600; color: var(--text-tertiary);
  margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.06em;
}
.field-group .field-value {
  font-size: 14px; padding: 10px 14px; background: var(--bg);
  border-radius: var(--radius-sm); line-height: 1.5; word-break: break-word;
  min-height: 38px; border: 1px solid var(--border); font-family: var(--font-en);
}
.field-group input, .field-group textarea, .field-group select {
  width: 100%; padding: 10px 12px; border: 1.5px solid var(--border);
  border-radius: var(--radius-sm); font-size: 14px; font-family: var(--font-en);
  background: var(--surface); color: var(--text); outline: none;
  transition: border-color 0.15s;
}
.field-group input:focus, .field-group textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-wash); }
.field-group textarea { resize: vertical; min-height: 60px; line-height: 1.5; }
.field-group select { cursor: pointer; }
.field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

/* ===== 详情 ===== */
.detail-field { padding: 5px 0; }
.detail-field .label { font-size: 11px; color: var(--text-tertiary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
.detail-field .value { font-size: 14px; line-height: 1.5; word-break: break-word; margin-top: 2px; font-family: var(--font-en); }
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 20px; }
.modal-actions {
  display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px;
  padding-top: 20px; border-top: 1px solid var(--border);
}
.changed-list {
  background: var(--success-light); border-radius: var(--radius-sm);
  padding: 12px 16px; margin-bottom: 14px; font-size: 13px;
  border: 1px solid #ccfbf1;
}
.changed-list li { margin: 4px 0; list-style: none; }
.changed-list .diff-old { text-decoration: line-through; color: var(--text-tertiary); }
.changed-list .diff-new { color: var(--success); font-weight: 600; }

/* ===== 底部 ===== */
.footer {
  margin-top: 48px; padding: 24px 0 0; text-align: center;
  font-size: 13px; color: var(--text-tertiary); border-top: 1px solid var(--border);
}
.footer .hint-block { display: flex; flex-direction: column; gap: 10px; align-items: center; }
.footer .hint,
.footer .shutdown-hint {
  background: var(--accent-light); color: var(--accent);
  padding: 10px 20px; border-radius: var(--radius-sm);
  display: inline-block; font-size: 13px;
  border: 1px solid #fecaca;
}

/* ===== 响应式 ===== */
@media (max-width: 640px) {
  .stats-bar .letter-grid { grid-template-columns: repeat(4, 1fr); }
  .detail-grid { grid-template-columns: 1fr; }
  .field-row { grid-template-columns: 1fr; }
  .container { padding: 28px 16px; }
  .suggestion-item .en { min-width: 90px; font-size: 13px; }
  .modal { padding: 24px; }
  .header { flex-direction: column; gap: 12px; align-items: stretch; }
  .btn-shutdown { align-self: flex-end; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="header-left">
      <h1>术语库<em>·</em>管理</h1>
      <p class="subtitle">输入英文或中文关键词，按前缀匹配搜索</p>
    </div>
    <button class="btn-shutdown" onclick="shutdownServer()" title="关闭服务">关闭服务</button>
  </div>

  <!-- 搜索框 -->
  <div class="search-wrapper">
    <input type="text" id="searchInput" placeholder="输入英文或中文关键词搜索术语…" autocomplete="off" autofocus>
  <button class="search-clear" id="searchClear" onclick="clearSearch()" title="清除搜索">&times;</button>
  <span class="search-icon">&#x1F50D;</span>
    <div class="suggestions" id="suggestions"></div>
  </div>

  <!-- 统计栏 -->
  <div class="stats-bar" id="statsBar">
    <div class="stats-loading">加载统计…</div>
  </div>

  <!-- 操作按钮 -->
  <div class="actions">
    <button class="btn btn-primary" onclick="openAdd()">新增术语</button>
  </div>

  <!-- 最近修改 -->
  <div class="recent-changes" id="recentChanges" style="display:none">
    <h3>最近修改</h3>
    <div class="recent-list" id="recentList"></div>
  </div>

  <!-- 底部 -->
  <div class="footer">
    <div class="hint-block">
      <div class="hint">批量扩充术语库请回到终端输入「我想扩充当前术语库」</div>
      <div class="shutdown-hint">使用完毕后请关闭服务，避免端口持续占用</div>
    </div>
  </div>
</div>

<!-- 详情弹窗 -->
<div class="overlay" id="detailOverlay" onclick="if(event.target===this)closeDetail()">
  <div class="modal" id="detailModal">
    <button class="modal-close" onclick="closeDetail()">&times;</button>
    <div id="detailContent"></div>
  </div>
</div>

<!-- 新增弹窗 -->
<div class="overlay" id="addOverlay" onclick="if(event.target===this)closeAdd()">
  <div class="modal" id="addModal">
    <button class="modal-close" onclick="closeAdd()">&times;</button>
    <h2>新增术语</h2>
    <div class="field-row">
      <div class="field-group"><label>英文 *</label><input id="addEn" placeholder="e.g. quadratic equation"></div>
      <div class="field-group"><label>中文 *</label><input id="addCn" placeholder="e.g. 二次方程"></div>
    </div>
    <div class="field-row">
      <div class="field-group"><label>词性</label><input id="addPos" placeholder="e.g. 名词"></div>
      <div class="field-group"><label>子领域</label><input id="addField" placeholder="e.g. 代数"></div>
    </div>
    <div class="field-group"><label>来源</label><input id="addSource" placeholder="词典/文献名称"></div>
    <div id="addConflict" style="display:none;background:var(--accent-light);padding:12px 16px;border-radius:var(--radius-sm);margin-bottom:14px;font-size:13px;border:1px solid #fecaca;">
      该术语已存在，确定要覆盖吗？
      <button class="btn btn-sm btn-primary" onclick="confirmOverwrite()" style="margin-left:8px;">覆盖</button>
      <button class="btn btn-sm btn-secondary" onclick="cancelOverwrite()" style="margin-left:4px;">取消</button>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeAdd()">取消</button>
      <button class="btn btn-primary" onclick="submitAdd()">保存</button>
    </div>
  </div>
</div>

<script>
let searchTimer = null;
let pendingEn = null;
let currentDetailTerm = null;
let isEditing = false;

(async function loadStats() { refreshStats(); loadRecentChanges(); })();

async function refreshStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    const bar = document.getElementById('statsBar');
    let html = '<div class="stat-row"><span class="stat-item"><span class="stat-num">' + data.total + '</span> <span class="stat-label">条术语</span></span>';
    if (data.sources.length > 0) {
      html += '<span class="stat-item"><span class="stat-label">术语来源：' + data.sources.map(esc).join(' · ') + '</span></span>';
    }
    html += '</div><div class="letter-grid">';
    data.letters.forEach(l => {
      var tooltip = l.letter === '#' ? ' title="以数字、符号等非字母开头的术语"' : (' title="点击查看 ' + l.letter + ' 开头的所有术语"');
      html += '<span class="letter-tag"' + tooltip + ' onclick="searchByLetter(\'' + l.letter + '\')">' + l.letter + ' <span class="c">' + l.count + '个</span></span>';
    });
    html += '</div>';
    bar.innerHTML = html;
  } catch(e) {
    document.getElementById('statsBar').innerHTML = '<span style="color:var(--danger)">统计加载失败</span>';
  }
}

async function loadRecentChanges() {
  try {
    const res = await fetch('/api/recent-changes');
    const data = await res.json();
    if (!data.changes || data.changes.length === 0) return;
    var container = document.getElementById('recentChanges');
    container.style.display = 'block';
    var actionMap = { '新增': 'add', '修改': 'edit', '删除': 'delete', '覆盖': 'edit' };
    var html = '';
    data.changes.reverse().forEach(function(c) {
      var cls = actionMap[c.action] || '';
      html += '<div class="recent-item"><span class="recent-time">' + esc(c.time) + '</span><span class="recent-action ' + cls + '">' + esc(c.action) + '</span><span class="recent-detail">' + esc(c.en) + ': ' + c.detail + '</span></div>';
    });
    document.getElementById('recentList').innerHTML = html;
  } catch(e) {}
}

// 搜索防抖
document.getElementById('searchInput').addEventListener('input', function() {
  clearTimeout(searchTimer);
  const q = this.value.trim();
  searchTimer = setTimeout(() => searchTerms(q), 200);
  // 显示/隐藏清除按钮
  document.getElementById('searchClear').classList.toggle('visible', q.length > 0);
});

// 清除搜索
function clearSearch() {
  var input = document.getElementById('searchInput');
  input.value = '';
  document.getElementById('searchClear').classList.remove('visible');
  searchTerms('');
  input.focus();
}

// 点击字母标签：填入搜索框并触发搜索
function searchByLetter(letter) {
  var input = document.getElementById('searchInput');
  input.value = letter;
  searchTerms(letter);
  input.focus();
}

async function searchTerms(q) {
  const sug = document.getElementById('suggestions');
  if (!q) {
    sug.classList.remove('active');
    return;
  }
  const res = await fetch('/api/terms?q=' + encodeURIComponent(q));
  const data = await res.json();
  const terms = data.terms || [];

  if (terms.length === 0) {
    sug.innerHTML = '<div class="no-results">未找到匹配术语</div>';
  } else {
    sug.innerHTML = terms.map(t =>
      '<div class="suggestion-item" data-term-id="' + esc(t.term_id) + '" onclick="openDetail(this.dataset.termId)">'
      + '<span class="idx">' + t.idx + '</span>'
      + '<span class="en">' + esc(t.en) + '</span>'
      + '<span class="sep">→</span>'
      + '<span class="cn">' + esc(t.cn) + '</span>'
      + (t.field ? '<span class="field-badge">' + esc(Array.isArray(t.field) ? t.field.join(' / ') : t.field) + '</span>' : '')
      + '</div>'
    ).join('');
  }
  sug.classList.add('active');
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// 详情
async function openDetail(termId) {
  const res = await fetch('/api/terms/' + encodeURIComponent(termId));
  const term = await res.json();
  if (term.error) { alert(term.error); return; }
  showDetailView(term);
}

function closeDetail() {
  document.getElementById('detailOverlay').classList.remove('active');
  currentDetailTerm = null;
  isEditing = false;
  // 不清空搜索框，如果当前有搜索结果则保留下拉
  var q = document.getElementById('searchInput').value.trim();
  if (q) {
    searchTerms(q);
  }
}

function showDetailView(term) {
  currentDetailTerm = term;
  isEditing = false;

  const allFields = [
    { key: 'idx', label: '序号' },
    { key: 'en', label: '英文' },
    { key: 'cn', label: '中文' },
    { key: 'pos', label: '词性' },
    { key: 'field', label: '领域' },
    { key: 'source', label: '来源' },
    { key: 'examples', label: '示例' },
    { key: 'created_at', label: '创建日期' },
    { key: 'updated_at', label: '更新日期' },
  ];

  const detailRows = allFields.map(f => {
    let val = term[f.key];
    if (f.key === 'field' && Array.isArray(val)) val = val.join(' / ');
    if (f.key === 'examples' && Array.isArray(val) && val.length > 0) {
      val = val.map((e, i) => (i + 1) + '. ' + esc(e.en) + ' → ' + esc(e.cn)).join('<br>');
      // 直接返回 HTML，不经过 esc(String(val))
      return '<div class="detail-field"><span class="label">' + f.label + '</span><div class="value">' + val + '</div></div>';
    }
    if (f.key === 'examples') {
      return '<div class="detail-field"><span class="label">' + f.label + '</span><div class="value">(空)</div></div>';
    }
    const isEmpty = val === undefined || val === null || val === '';
    const displayVal = isEmpty ? '(空)' : esc(String(val));
    return '<div class="detail-field"><span class="label">' + f.label + '</span><div class="value">' + displayVal + '</div></div>';
  }).join('');

  const content = document.getElementById('detailContent');
  content.innerHTML = '<h2>术语详情</h2>'
    + '<div class="detail-grid">' + detailRows + '</div>'
    + '<div class="modal-actions">'
    + '<button class="btn btn-sm btn-primary" onclick="enterEditMode()">编辑</button>'
    + '<button class="btn btn-sm btn-danger" onclick="confirmDelete()">删除</button>'
    + '</div>';
  document.getElementById('detailOverlay').classList.add('active');
}

function enterEditMode() {
  if (isEditing) return;
  const term = currentDetailTerm;
  if (!term) { alert('请先选择一条术语'); return; }
  if (typeof term !== 'object' || term === null) {
    alert('无法加载术语数据，请重新打开详情');
    return;
  }
  isEditing = true;

  const labels = { en: '英文 *', cn: '中文 *', pos: '词性', field: '子领域', source: '来源' };
  const placeholders = { en: 'e.g. quadratic equation', cn: 'e.g. 二次方程', pos: 'e.g. 名词', field: 'e.g. 代数', source: '词典/文献名称' };

  const renderEditField = (key, label) => {
    const raw = term[key];
    const val = Array.isArray(raw)
      ? raw.join(' / ')
      : (raw !== undefined && raw !== null && raw !== '' ? String(raw) : '');
    const ph = placeholders[key] || '';
    return '<div class="field-group"><label>' + label + '</label><input id="edit_' + key + '" value="' + esc(val) + '" placeholder="' + ph + '">';
  };

  // 编辑模式字段布局
  const editRows = [['en', 'cn'], ['pos', 'field'], ['source']];

  document.getElementById('detailContent').innerHTML = '<h2>编辑术语信息</h2>'
    + '<div id="editChanged" style="display:none"></div>'
    + editRows.map(keys => {
        if (keys.length === 2) {
          return '<div class="field-row">' + keys.map(k => renderEditField(k, labels[k])).join('') + '</div>';
        }
        return renderEditField(keys[0], labels[keys[0]]);
      }).join('')
    + '<div class="modal-actions">'
    + '<button class="btn btn-secondary" onclick="showDetailView(currentDetailTerm)">取消</button>'
    + '<button class="btn btn-primary" onclick="submitEdit()">保存</button>'
    + '</div>';
}

async function submitEdit() {
  const term = currentDetailTerm;
  if (!term) return;
  const changed = {};
  ['cn','pos','field','source'].forEach(key => {
    const el = document.getElementById('edit_' + key);
    if (!el) return;
    let val = el.value;
    if (term[key] !== val) changed[key] = val;
  });
  if (Object.keys(changed).length === 0) { closeDetail(); return; }

  const res = await fetch('/api/terms/' + encodeURIComponent(term.term_id), {
    method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(changed),
  });
  const data = await res.json();
  if (data.error) { alert(data.error); return; }
  if (data.warning) { alert(data.warning); }

  if (data.changed && Object.keys(data.changed).length > 0) {
    let html = '<div class="changed-list"><strong>修改了以下字段：</strong><ul>';
    for (const [k, v] of Object.entries(data.changed)) {
      let oldDisp = v.old;
      let newDisp = v.new;
      if (Array.isArray(oldDisp)) oldDisp = oldDisp.join(', ');
      if (Array.isArray(newDisp)) newDisp = newDisp.join(', ');
      if (typeof oldDisp === 'boolean') oldDisp = oldDisp ? '是' : '否';
      if (typeof newDisp === 'boolean') newDisp = newDisp ? '是' : '否';
      if (oldDisp === '' || oldDisp === null || oldDisp === undefined) oldDisp = '(空)';
      if (newDisp === '' || newDisp === null || newDisp === undefined) newDisp = '(空)';
      html += '<li>' + esc(k) + ': <span class="diff-old">' + esc(oldDisp) + '</span> → <span class="diff-new">' + esc(newDisp) + '</span></li>';
    }
    html += '</ul></div>';
    document.getElementById('editChanged').style.display = 'block';
    document.getElementById('editChanged').innerHTML = html;
  }
  currentDetailTerm = data.term;
  refreshStats();
  loadRecentChanges();
  // 刷新搜索结果
  var q = document.getElementById('searchInput').value.trim();
  if (q) searchTerms(q);
  setTimeout(closeDetail, 2000);
}

// 删除
let deleteTargetId = null;
function confirmDelete() {
  // 先捕获 term_id，再关闭弹窗（closeDetail 会清空 currentDetailTerm）
  deleteTargetId = currentDetailTerm ? currentDetailTerm.term_id : null;
  var en = currentDetailTerm ? currentDetailTerm.en : '';
  closeDetail();
  setTimeout(() => {
    if (!confirm('确定要删除术语 "' + en + '" 吗？此操作不可撤销。')) return;
    executeDelete();
  }, 200);
}

async function executeDelete() {
  if (!deleteTargetId) return;
  const res = await fetch('/api/terms/' + encodeURIComponent(deleteTargetId), { method: 'DELETE' });
  const data = await res.json();
  if (data.error) { alert(data.error); return; }
  refreshStats();
  loadRecentChanges();
  var q = document.getElementById('searchInput').value.trim();
  if (q) searchTerms(q);
  alert(data.message + (data.warning ? '\n' + data.warning : ''));
}

// 新增
function openAdd() {
  pendingEn = null;
  ['addEn','addCn','addPos','addField','addSource'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('addConflict').style.display = 'none';
  document.getElementById('addOverlay').classList.add('active');
  document.getElementById('addEn').focus();
}

function closeAdd() { document.getElementById('addOverlay').classList.remove('active'); pendingEn = null; }

async function submitAdd() {
  const en = document.getElementById('addEn').value.trim();
  const cn = document.getElementById('addCn').value.trim();
  if (!en || !cn) { alert('英文和中文为必填项'); return; }
  const body = {
    en, cn,
    pos: document.getElementById('addPos').value.trim(),
    field: document.getElementById('addField').value.trim(),
    source: document.getElementById('addSource').value.trim(),
    examples: [],
  };
  if (pendingEn === en) body.force = true;
  const res = await fetch('/api/terms', {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body),
  });
  const data = await res.json();
  if (res.status === 409 && data.existing && !body.force) {
    pendingEn = en;
    document.getElementById('addConflict').style.display = 'block';
    return;
  }
  if (data.error && res.status !== 409) { alert(data.error); return; }
  closeAdd();
  refreshStats();
  loadRecentChanges();
  // 如果当前搜索框有输入，刷新搜索结果
  var q = document.getElementById('searchInput').value.trim();
  if (q) searchTerms(q);
  alert(data.message + (data.warning ? '\n' + data.warning : ''));
}

function confirmOverwrite() { pendingEn = null; submitAdd(); }
function cancelOverwrite() { pendingEn = null; document.getElementById('addConflict').style.display = 'none'; }

async function shutdownServer() {
  if (confirm('确定要关闭术语库管理服务吗？')) {
    try {
      const res = await fetch('/api/shutdown', { method: 'POST' });
      const data = await res.json();
      alert(data.message || data.error || '已发送关闭请求');
    } catch (error) {
      alert('连接已断开；如服务仍在运行，请在启动终端按 Ctrl+C。');
    }
  }
}
</script>
</body>
</html>"""


# --- 入口 ---

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="启动本地术语库管理界面。")
    parser.add_argument(
        "--glossary",
        required=True,
        help="要维护的 glossary.json 路径",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7788)
    parser.add_argument(
        "--allow-remote",
        action="store_true",
        help="显式允许绑定非 loopback 地址；界面没有身份认证",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="不自动打开系统默认浏览器",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not 1 <= args.port <= 65535:
        print("错误：port 必须在 1 到 65535 之间")
        return 2
    loopback_hosts = {"127.0.0.1", "::1", "localhost"}
    if args.host not in loopback_hosts and not args.allow_remote:
        print(
            "错误：Web 界面没有身份认证。绑定非 loopback 地址时必须显式"
            "添加 --allow-remote。"
        )
        return 2

    try:
        glossary = configure(args.glossary)
    except (FileNotFoundError, json.JSONDecodeError, ValueError) as exc:
        print(f"错误：{exc}")
        return 2

    browser_host = "localhost" if args.host in loopback_hosts else args.host
    url = f"http://{browser_host}:{args.port}"

    if not args.no_browser:
        def _open_browser():
            time.sleep(1)
            webbrowser.open(url)

        threading.Thread(target=_open_browser, daemon=True).start()

    print("术语库管理界面启动中...")
    print(f"  术语库: {glossary}")
    print(f"  地址:   {url}")
    print("  按 Ctrl+C 停止服务器")
    app.run(
        host=args.host,
        port=args.port,
        debug=False,
        use_reloader=False,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
