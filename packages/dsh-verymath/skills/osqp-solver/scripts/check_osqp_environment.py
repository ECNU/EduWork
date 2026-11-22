#!/usr/bin/env python3
"""Probe the Python dependencies required by the OSQP skill without installing."""

from __future__ import annotations

import argparse
import importlib
import importlib.util
import json
import re
import sys
from importlib import metadata
from typing import Any


PACKAGES = ("osqp", "numpy", "scipy")
OSQP_REQUIREMENT = "osqp>=1,<2"
SUPPORTED_OSQP_MAJOR = 1


def package_version(name: str) -> str | None:
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return None


def probe_package(name: str) -> dict[str, Any]:
    spec = importlib.util.find_spec(name)
    if spec is None:
        return {
            "available": False,
            "version": None,
            "path": None,
            "error": "module not found",
        }

    try:
        module = importlib.import_module(name)
    except Exception as exc:  # noqa: BLE001 - preserve the import failure
        return {
            "available": False,
            "version": package_version(name),
            "path": getattr(spec, "origin", None),
            "error": f"{type(exc).__name__}: {exc}",
        }

    return {
        "available": True,
        "version": getattr(module, "__version__", None) or package_version(name),
        "path": getattr(module, "__file__", None),
        "error": None,
    }


def osqp_compatibility(version: Any) -> tuple[bool, str | None]:
    if not isinstance(version, str):
        return False, f"cannot determine OSQP version; requires {OSQP_REQUIREMENT}"
    match = re.match(r"^\s*(\d+)(?:\.|$)", version)
    if match is None:
        return (
            False,
            f"cannot parse OSQP version {version!r}; requires {OSQP_REQUIREMENT}",
        )
    if int(match.group(1)) != SUPPORTED_OSQP_MAJOR:
        return False, f"OSQP {version} is incompatible; requires {OSQP_REQUIREMENT}"
    return True, None


def build_report() -> dict[str, Any]:
    packages = {name: probe_package(name) for name in PACKAGES}
    osqp_info = packages["osqp"]
    compatible, compatibility_error = (
        osqp_compatibility(osqp_info["version"])
        if osqp_info["available"]
        else (False, f"OSQP is unavailable; requires {OSQP_REQUIREMENT}")
    )
    osqp_info["compatible"] = compatible
    osqp_info["requirement"] = OSQP_REQUIREMENT
    osqp_info["compatibility_error"] = compatibility_error
    return {
        "python": sys.executable,
        "python_version": sys.version.split()[0],
        "ready": all(info["available"] for info in packages.values()) and compatible,
        "packages": packages,
        "install_hint": f"python3 -m pip install '{OSQP_REQUIREMENT}'",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="print JSON")
    args = parser.parse_args()

    report = build_report()
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0

    print(f"Python: {report['python']} ({report['python_version']})")
    for name, info in report["packages"].items():
        state = "ok" if info["available"] else "missing"
        if name == "osqp" and info["available"] and not info["compatible"]:
            state = "incompatible"
        print(
            f"{name}: {state}, version={info['version'] or '-'}, "
            f"path={info['path'] or '-'}"
        )
        if info["error"]:
            print(f"  error: {info['error']}")
        if name == "osqp" and info["compatibility_error"]:
            print(f"  compatibility_error: {info['compatibility_error']}")
    print(f"ready: {str(report['ready']).lower()}")
    if not report["ready"]:
        print(f"install_hint: {report['install_hint']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
