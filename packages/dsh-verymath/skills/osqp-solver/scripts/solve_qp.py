#!/usr/bin/env python3
"""Solve and independently verify a small dense JSON quadratic program."""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import math
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any, Iterable


SCHEMA_VERSION = "osqp-solver-result-v1"
OSQP_REQUIREMENT = "osqp>=1,<2"
SUPPORTED_OSQP_MAJOR = 1
MAX_INPUT_BYTES = 32 * 1024 * 1024
MAX_DENSE_VARIABLES = 1000
MAX_DENSE_ENTRIES = 2_000_000
STATUS_BY_VALUE = {
    1: ("solved", False, "solution"),
    2: ("solved_inaccurate", True, "solution"),
    3: ("primal_infeasible", False, "primal_certificate"),
    4: ("primal_infeasible_inaccurate", True, "primal_certificate"),
    5: ("dual_infeasible", False, "dual_certificate"),
    6: ("dual_infeasible_inaccurate", True, "dual_certificate"),
    7: ("maximum_iterations_reached", False, "failure"),
    8: ("time_limit_reached", False, "failure"),
    9: ("problem_non_convex", False, "failure"),
    10: ("interrupted", False, "failure"),
    11: ("unsolved", False, "failure"),
}

BOOLEAN_SETTINGS = {
    "adaptive_rho",
    "polishing",
    "scaled_termination",
    "warm_starting",
}
INTEGER_SETTINGS = {
    "adaptive_rho_interval": (0, None),
    "check_termination": (0, None),
    "max_iter": (1, None),
    "polish_refine_iter": (1, None),
    "scaling": (0, None),
}
FLOAT_SETTINGS = {
    "adaptive_rho_fraction": (0.0, None, False, False),
    "adaptive_rho_tolerance": (1.0, None, True, False),
    "alpha": (0.0, 2.0, False, False),
    "delta": (0.0, None, False, False),
    "eps_abs": (0.0, None, True, False),
    "eps_dual_inf": (0.0, None, False, False),
    "eps_prim_inf": (0.0, None, False, False),
    "eps_rel": (0.0, None, True, False),
    "rho": (0.0, None, False, False),
    "sigma": (0.0, None, False, False),
    "time_limit": (0.0, None, False, False),
}
ALLOWED_SETTINGS = (
    BOOLEAN_SETTINGS | set(INTEGER_SETTINGS) | set(FLOAT_SETTINGS) | {"verbose"}
)
ALLOWED_TOP_LEVEL_FIELDS = {"name", "P", "q", "A", "l", "u", "settings"}


class InputError(ValueError):
    """Raised when the JSON problem is not a valid runner input."""


class DependencyError(RuntimeError):
    """Raised when the numerical runtime is unavailable."""


def _number(value: Any, label: str, *, allow_infinity: bool = False) -> float:
    if isinstance(value, bool):
        raise InputError(f"{label} must be numeric, not boolean")

    if isinstance(value, str) and allow_infinity:
        normalized = value.strip().lower()
        if normalized in {"inf", "+inf", "infinity", "+infinity"}:
            return math.inf
        if normalized in {"-inf", "-infinity"}:
            return -math.inf

    if not isinstance(value, (int, float)):
        raise InputError(f"{label} must be numeric")

    result = float(value)
    if math.isnan(result):
        raise InputError(f"{label} must not be NaN")
    if not allow_infinity and not math.isfinite(result):
        raise InputError(f"{label} must be finite")
    return result


def _vector(raw: Any, label: str, *, allow_infinity: bool = False) -> list[float]:
    if not isinstance(raw, list):
        raise InputError(f"{label} must be a JSON array")
    return [
        _number(value, f"{label}[{index}]", allow_infinity=allow_infinity)
        for index, value in enumerate(raw)
    ]


def _matrix(raw: Any, label: str) -> list[list[float]]:
    if not isinstance(raw, list):
        raise InputError(f"{label} must be a JSON array of rows")
    matrix: list[list[float]] = []
    width: int | None = None
    for row_index, row in enumerate(raw):
        if not isinstance(row, list):
            raise InputError(f"{label}[{row_index}] must be a JSON array")
        parsed = [
            _number(value, f"{label}[{row_index}][{column_index}]")
            for column_index, value in enumerate(row)
        ]
        if width is None:
            width = len(parsed)
        elif len(parsed) != width:
            raise InputError(f"{label} rows must all have the same length")
        matrix.append(parsed)
    return matrix


def _validate_settings(raw: Any) -> dict[str, Any]:
    if raw is None:
        return {"verbose": False}
    if not isinstance(raw, dict):
        raise InputError("settings must be a JSON object")
    settings: dict[str, Any] = {}
    for key, value in raw.items():
        if not isinstance(key, str) or not key:
            raise InputError("settings keys must be non-empty strings")
        if key not in ALLOWED_SETTINGS:
            allowed = ", ".join(sorted(ALLOWED_SETTINGS))
            raise InputError(f"unsupported settings.{key}; allowed settings: {allowed}")

        if key == "verbose":
            if not isinstance(value, bool):
                raise InputError("settings.verbose must be boolean")
            if value:
                raise InputError(
                    "settings.verbose=true is not supported because stdout is reserved "
                    "for one machine-readable JSON report"
                )
            settings[key] = False
        elif key in BOOLEAN_SETTINGS:
            if not isinstance(value, bool):
                raise InputError(f"settings.{key} must be boolean")
            settings[key] = value
        elif key in INTEGER_SETTINGS:
            if isinstance(value, bool) or not isinstance(value, int):
                raise InputError(f"settings.{key} must be an integer")
            lower, upper = INTEGER_SETTINGS[key]
            if value < lower or (upper is not None and value > upper):
                interval = f">= {lower}" if upper is None else f"in [{lower}, {upper}]"
                raise InputError(f"settings.{key} must be {interval}")
            settings[key] = value
        else:
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise InputError(f"settings.{key} must be numeric")
            number = float(value)
            if not math.isfinite(number):
                raise InputError(f"settings.{key} must be finite")
            lower, upper, include_lower, include_upper = FLOAT_SETTINGS[key]
            lower_ok = number >= lower if include_lower else number > lower
            upper_ok = (
                True
                if upper is None
                else number <= upper
                if include_upper
                else number < upper
            )
            if not lower_ok or not upper_ok:
                left = "[" if include_lower else "("
                right = "]" if include_upper else ")"
                upper_text = "infinity" if upper is None else str(upper)
                raise InputError(
                    f"settings.{key} must be in {left}{lower}, {upper_text}{right}"
                )
            settings[key] = number

    if settings.get("eps_abs", 1e-3) == 0.0 and settings.get("eps_rel", 1e-3) == 0.0:
        raise InputError("settings.eps_abs and settings.eps_rel cannot both be zero")
    settings["verbose"] = False
    return settings


def validate_problem(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise InputError("the input root must be a JSON object")
    unknown = sorted(set(raw) - ALLOWED_TOP_LEVEL_FIELDS)
    if unknown:
        raise InputError(f"unknown top-level field(s): {', '.join(unknown)}")

    missing = [key for key in ("P", "q", "A", "l", "u") if key not in raw]
    if missing:
        raise InputError(f"missing required field(s): {', '.join(missing)}")

    q = _vector(raw["q"], "q")
    if not q:
        raise InputError("q must contain at least one variable")
    n = len(q)
    if n > MAX_DENSE_VARIABLES:
        raise InputError(
            f"dense runner limit exceeded: n={n}, maximum is "
            f"{MAX_DENSE_VARIABLES}; use the native sparse OSQP API"
        )

    p_matrix = _matrix(raw["P"], "P")
    if len(p_matrix) != n or any(len(row) != n for row in p_matrix):
        raise InputError(f"P must have shape ({n}, {n})")

    max_abs_p = max((abs(value) for row in p_matrix for value in row), default=0.0)
    symmetry_tolerance = 1e-10 * max(1.0, max_abs_p)
    max_asymmetry = max(
        abs(p_matrix[i][j] - p_matrix[j][i])
        for i in range(n)
        for j in range(n)
    )
    if max_asymmetry > symmetry_tolerance:
        raise InputError(
            "P must be symmetric; "
            f"max asymmetry {max_asymmetry:.3e} exceeds {symmetry_tolerance:.3e}"
        )
    p_matrix = [
        [
            0.5
            * (
                p_matrix[row_index][column_index]
                + p_matrix[column_index][row_index]
            )
            for column_index in range(n)
        ]
        for row_index in range(n)
    ]

    a_matrix = _matrix(raw["A"], "A")
    if a_matrix and any(len(row) != n for row in a_matrix):
        raise InputError(f"A must have {n} columns")
    m = len(a_matrix)
    dense_entries = n * n + m * n
    if dense_entries > MAX_DENSE_ENTRIES:
        raise InputError(
            "dense runner limit exceeded: "
            f"P and A contain {dense_entries} logical entries, maximum is "
            f"{MAX_DENSE_ENTRIES}; use the native sparse OSQP API"
        )

    lower = _vector(raw["l"], "l", allow_infinity=True)
    upper = _vector(raw["u"], "u", allow_infinity=True)
    if len(lower) != m or len(upper) != m:
        raise InputError(f"l and u must each have length {m}")
    for index, (lo, hi) in enumerate(zip(lower, upper)):
        if lo == math.inf:
            raise InputError(f"l[{index}] cannot be +infinity")
        if hi == -math.inf:
            raise InputError(f"u[{index}] cannot be -infinity")
        if lo > hi:
            raise InputError(f"l[{index}] must be <= u[{index}]")

    settings = _validate_settings(raw.get("settings"))
    settings.setdefault("verbose", False)
    return {
        "name": str(raw.get("name", "unnamed-qp")),
        "P": p_matrix,
        "q": q,
        "A": a_matrix,
        "l": lower,
        "u": upper,
        "settings": settings,
        "dimensions": {"n": n, "m": m},
        "structural_checks": {
            "symmetric_P": True,
            "max_P_asymmetry": max_asymmetry,
            "P_canonicalized": bool(max_asymmetry > 0.0),
            "consistent_dimensions": True,
            "ordered_bounds": True,
            "dense_entries": dense_entries,
        },
    }


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise InputError(f"duplicate JSON object key: {key}")
        result[key] = value
    return result


def load_problem(path: Path) -> dict[str, Any]:
    try:
        input_size = path.stat().st_size
        if input_size > MAX_INPUT_BYTES:
            raise InputError(
                f"input file is {input_size} bytes; maximum is {MAX_INPUT_BYTES} "
                "for the small dense runner"
            )
        raw = json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=_unique_object,
        )
    except OSError as exc:
        raise InputError(f"cannot read {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise InputError(f"invalid JSON in {path}: {exc}") from exc
    return validate_problem(raw)


def _parse_osqp_major(version: Any) -> int | None:
    if not isinstance(version, str):
        return None
    match = re.match(r"^\s*(\d+)(?:\.|$)", version)
    if match is None:
        return None
    return int(match.group(1))


def load_numeric_stack() -> tuple[Any, Any, Any]:
    try:
        import numpy as np
        import osqp
        from scipy import sparse
    except ModuleNotFoundError as exc:
        raise DependencyError(
            f"missing Python dependency {exc.name!r}; run: "
            f"python3 -m pip install '{OSQP_REQUIREMENT}'"
        ) from exc
    version = getattr(osqp, "__version__", None)
    major = _parse_osqp_major(version)
    if major != SUPPORTED_OSQP_MAJOR:
        shown = version if version is not None else "unknown"
        raise DependencyError(
            f"incompatible OSQP version {shown!r}; this runner requires "
            f"{OSQP_REQUIREMENT}"
        )
    return np, osqp, sparse


def _norm_inf(np: Any, values: Any) -> float:
    array = np.asarray(values, dtype=float)
    if array.size == 0:
        return 0.0
    return float(np.max(np.abs(array)))


def _finite_float(value: Any) -> float | int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    if number.is_integer() and isinstance(value, int):
        return int(value)
    return number


def _array_list(np: Any, value: Any) -> list[float] | None:
    if value is None:
        return None
    array = np.asarray(value, dtype=float).reshape(-1)
    if not bool(np.all(np.isfinite(array))):
        return None
    return [float(item) for item in array]


def _normalized_certificate(
    np: Any,
    certificate: Any,
    expected_size: int,
) -> tuple[Any | None, float | None, str | None]:
    if certificate is None:
        return None, None, "certificate is missing"
    try:
        vector = np.asarray(certificate, dtype=float).reshape(-1)
    except (TypeError, ValueError) as exc:
        return None, None, f"certificate is not numeric: {exc}"
    if vector.size != expected_size:
        return (
            None,
            None,
            f"certificate has length {vector.size}; expected {expected_size}",
        )
    if not bool(np.all(np.isfinite(vector))):
        return None, None, "certificate contains a non-finite value"
    norm = _norm_inf(np, vector)
    if norm == 0.0:
        return None, norm, "certificate is the zero vector"
    normalized = vector / norm
    if not bool(np.all(np.isfinite(normalized))):
        return None, norm, "certificate normalization produced a non-finite value"
    return normalized, norm, None


def _first_attribute(obj: Any, *names: str) -> Any:
    for name in names:
        if hasattr(obj, name):
            return getattr(obj, name)
    return None


def _solver_statistics(info: Any) -> dict[str, Any]:
    fields = {
        "objective": ("obj_val",),
        "dual_objective": ("dual_obj_val",),
        "primal_residual": ("prim_res", "pri_res"),
        "dual_residual": ("dual_res", "dua_res"),
        "duality_gap": ("duality_gap",),
        "iterations": ("iter",),
        "rho_updates": ("rho_updates",),
        "rho_estimate": ("rho_estimate",),
        "setup_time": ("setup_time",),
        "solve_time": ("solve_time",),
        "update_time": ("update_time",),
        "polish_time": ("polish_time",),
        "run_time": ("run_time",),
    }
    return {
        output_name: _finite_float(_first_attribute(info, *source_names))
        for output_name, source_names in fields.items()
    }


def verify_solution(
    np: Any,
    problem: dict[str, Any],
    p_matrix: Any,
    a_matrix: Any,
    x: Any,
    y: Any,
    min_eigenvalue: float,
    psd_tolerance: float,
    verify_tolerance: float,
) -> dict[str, Any]:
    q = np.asarray(problem["q"], dtype=float)
    lower = np.asarray(problem["l"], dtype=float)
    upper = np.asarray(problem["u"], dtype=float)
    x = np.asarray(x, dtype=float).reshape(-1)
    y = np.asarray(y, dtype=float).reshape(-1)
    if x.size != q.size or y.size != lower.size:
        return {
            "kind": "solution",
            "passed": False,
            "reason": (
                f"solution dimensions are x={x.size}, y={y.size}; expected "
                f"x={q.size}, y={lower.size}"
            ),
        }
    if not bool(np.all(np.isfinite(x))) or not bool(np.all(np.isfinite(y))):
        return {
            "kind": "solution",
            "passed": False,
            "reason": "solution contains a non-finite primal or dual value",
        }
    ax = a_matrix @ x

    lower_violation = np.where(np.isfinite(lower), np.maximum(lower - ax, 0.0), 0.0)
    upper_violation = np.where(np.isfinite(upper), np.maximum(ax - upper, 0.0), 0.0)
    primal_violation = max(
        _norm_inf(np, lower_violation),
        _norm_inf(np, upper_violation),
    )
    stationarity = _norm_inf(np, p_matrix @ x + q + a_matrix.T @ y)
    objective = float(0.5 * x @ (p_matrix @ x) + q @ x)

    projected = np.minimum(np.maximum(ax, lower), upper)
    eps_abs = float(problem["settings"].get("eps_abs", 1e-3))
    eps_rel = float(problem["settings"].get("eps_rel", 1e-3))
    eps_primal = eps_abs + eps_rel * max(_norm_inf(np, ax), _norm_inf(np, projected))
    eps_dual = eps_abs + eps_rel * max(
        _norm_inf(np, p_matrix @ x),
        _norm_inf(np, a_matrix.T @ y),
        _norm_inf(np, q),
    )
    primal_threshold = max(verify_tolerance, eps_primal)
    dual_threshold = max(verify_tolerance, eps_dual)

    normal_cone_violations: list[float] = []
    lower_complementarity: list[float] = []
    upper_complementarity: list[float] = []
    for lo, hi, activity, dual in zip(lower, upper, ax, y):
        lo_finite = math.isfinite(float(lo))
        hi_finite = math.isfinite(float(hi))
        at_lower = lo_finite and float(activity) <= float(lo) + primal_threshold
        at_upper = hi_finite and float(activity) >= float(hi) - primal_threshold
        dual_value = float(dual)

        if at_lower and at_upper:
            normal_cone_violations.append(0.0)
        elif at_lower:
            normal_cone_violations.append(max(dual_value, 0.0))
        elif at_upper:
            normal_cone_violations.append(max(-dual_value, 0.0))
        else:
            normal_cone_violations.append(abs(dual_value))

        if lo_finite:
            lower_multiplier = max(-dual_value, 0.0)
            lower_slack = max(float(activity) - float(lo), 0.0)
            lower_complementarity.append(lower_multiplier * lower_slack)
        if hi_finite:
            upper_multiplier = max(dual_value, 0.0)
            upper_slack = max(float(hi) - float(activity), 0.0)
            upper_complementarity.append(upper_multiplier * upper_slack)

    normal_cone_violation = max(normal_cone_violations, default=0.0)
    complementarity = max(
        max(lower_complementarity, default=0.0),
        max(upper_complementarity, default=0.0),
    )
    normal_cone_threshold = dual_threshold
    complementarity_threshold = max(
        verify_tolerance,
        primal_threshold * max(1.0, _norm_inf(np, y)),
    )

    return {
        "kind": "solution",
        "passed": bool(
            primal_violation <= primal_threshold
            and stationarity <= dual_threshold
            and normal_cone_violation <= normal_cone_threshold
            and complementarity <= complementarity_threshold
            and min_eigenvalue >= -psd_tolerance
        ),
        "primal_bound_violation_inf": primal_violation,
        "stationarity_inf": stationarity,
        "normal_cone_violation_inf": normal_cone_violation,
        "complementarity_inf": complementarity,
        "objective_recomputed": objective,
        "minimum_P_eigenvalue": min_eigenvalue,
        "psd_tolerance": psd_tolerance,
        "primal_threshold": primal_threshold,
        "dual_threshold": dual_threshold,
        "normal_cone_threshold": normal_cone_threshold,
        "complementarity_threshold": complementarity_threshold,
        "requested_floor_tolerance": verify_tolerance,
    }


def verify_primal_certificate(
    np: Any,
    problem: dict[str, Any],
    a_matrix: Any,
    certificate: Any,
    verify_tolerance: float,
) -> dict[str, Any]:
    lower = np.asarray(problem["l"], dtype=float)
    upper = np.asarray(problem["u"], dtype=float)
    eps_certificate = float(problem["settings"].get("eps_prim_inf", 1e-4))
    threshold = max(verify_tolerance, eps_certificate)
    vector, certificate_norm, error = _normalized_certificate(
        np, certificate, lower.size
    )
    if error is not None:
        return {
            "kind": "primal_infeasibility_certificate",
            "passed": False,
            "reason": error,
            "certificate_norm_inf": certificate_norm,
            "normalized": False,
            "threshold": threshold,
        }

    positive = np.maximum(vector, 0.0)
    negative = np.minimum(vector, 0.0)
    invalid_positive_ray = np.where(np.isposinf(upper), positive, 0.0)
    invalid_negative_ray = np.where(np.isneginf(lower), -negative, 0.0)
    infinite_bound_violation = max(
        _norm_inf(np, invalid_positive_ray),
        _norm_inf(np, invalid_negative_ray),
    )
    finite_upper = np.isfinite(upper)
    finite_lower = np.isfinite(lower)
    with np.errstate(over="ignore", invalid="ignore"):
        support = float(
            upper[finite_upper] @ positive[finite_upper]
            + lower[finite_lower] @ negative[finite_lower]
        )
        support_scale = float(
            np.abs(upper[finite_upper]) @ positive[finite_upper]
            + np.abs(lower[finite_lower]) @ (-negative[finite_lower])
        )
    strict_negative_margin = threshold * max(1.0, support_scale)
    null_residual = _norm_inf(np, a_matrix.T @ vector)
    finite_checks = all(
        math.isfinite(value)
        for value in (
            support,
            support_scale,
            strict_negative_margin,
            null_residual,
            infinite_bound_violation,
        )
    )
    return {
        "kind": "primal_infeasibility_certificate",
        "passed": bool(
            finite_checks
            and null_residual <= threshold
            and infinite_bound_violation <= threshold
            and support < -strict_negative_margin
        ),
        "A_transpose_v_inf": null_residual,
        "support_value": _finite_float(support),
        "support_scale": _finite_float(support_scale),
        "infinite_bound_direction_violation_inf": infinite_bound_violation,
        "certificate_norm_inf": certificate_norm,
        "normalized": True,
        "strict_negative_margin": _finite_float(strict_negative_margin),
        "threshold": threshold,
    }


def verify_dual_certificate(
    np: Any,
    problem: dict[str, Any],
    p_matrix: Any,
    a_matrix: Any,
    certificate: Any,
    verify_tolerance: float,
) -> dict[str, Any]:
    q = np.asarray(problem["q"], dtype=float)
    lower = np.asarray(problem["l"], dtype=float)
    upper = np.asarray(problem["u"], dtype=float)
    eps_certificate = float(problem["settings"].get("eps_dual_inf", 1e-4))
    threshold = max(verify_tolerance, eps_certificate)
    vector, certificate_norm, error = _normalized_certificate(
        np, certificate, q.size
    )
    if error is not None:
        return {
            "kind": "dual_infeasibility_certificate",
            "passed": False,
            "reason": error,
            "certificate_norm_inf": certificate_norm,
            "normalized": False,
            "threshold": threshold,
        }
    a_direction = a_matrix @ vector

    violations: list[float] = []
    for lo, hi, direction in zip(lower, upper, a_direction):
        if math.isfinite(lo) and math.isfinite(hi):
            violations.append(abs(float(direction)))
        elif math.isfinite(lo) and math.isposinf(hi):
            violations.append(max(-float(direction), 0.0))
        elif math.isneginf(lo) and math.isfinite(hi):
            violations.append(max(float(direction), 0.0))
    direction_violation = max(violations, default=0.0)
    p_residual = _norm_inf(np, p_matrix @ vector)
    with np.errstate(over="ignore", invalid="ignore"):
        q_direction = float(q @ vector)
        q_scale = float(np.abs(q) @ np.abs(vector))
    strict_negative_margin = threshold * max(1.0, q_scale)
    finite_checks = all(
        math.isfinite(value)
        for value in (
            direction_violation,
            p_residual,
            q_direction,
            q_scale,
            strict_negative_margin,
        )
    )
    return {
        "kind": "dual_infeasibility_certificate",
        "passed": bool(
            finite_checks
            and p_residual <= threshold
            and direction_violation <= threshold
            and q_direction < -strict_negative_margin
        ),
        "P_s_inf": p_residual,
        "q_transpose_s": _finite_float(q_direction),
        "q_direction_scale": _finite_float(q_scale),
        "constraint_direction_violation_inf": direction_violation,
        "certificate_norm_inf": certificate_norm,
        "normalized": True,
        "strict_negative_margin": _finite_float(strict_negative_margin),
        "threshold": threshold,
    }


def _payload_is_accepted(
    payload_kind: str,
    verification_passed: bool,
    inaccurate: bool,
    accept_inaccurate: bool,
) -> bool:
    return bool(
        payload_kind != "failure"
        and verification_passed
        and (accept_inaccurate or not inaccurate)
    )


def solve_problem(
    problem: dict[str, Any],
    *,
    verify_tolerance: float,
    accept_inaccurate: bool,
) -> tuple[dict[str, Any], bool]:
    np, osqp, sparse = load_numeric_stack()
    p_matrix = np.asarray(problem["P"], dtype=float)
    q = np.asarray(problem["q"], dtype=float)
    if problem["A"]:
        a_matrix = np.asarray(problem["A"], dtype=float)
    else:
        a_matrix = np.empty((0, problem["dimensions"]["n"]), dtype=float)
    lower = np.asarray(problem["l"], dtype=float)
    upper = np.asarray(problem["u"], dtype=float)

    eigenvalues = np.linalg.eigvalsh(p_matrix)
    min_eigenvalue = float(np.min(eigenvalues))
    psd_tolerance = 1e-9 * max(1.0, _norm_inf(np, eigenvalues))
    if min_eigenvalue < -psd_tolerance:
        raise InputError(
            "P is not positive semidefinite within the runner tolerance; "
            f"minimum eigenvalue={min_eigenvalue:.6e}"
        )

    solver_stdout = io.StringIO()
    with contextlib.redirect_stdout(solver_stdout):
        model = osqp.OSQP()
        model.setup(
            P=sparse.csc_matrix(np.triu(p_matrix)),
            q=q,
            A=sparse.csc_matrix(a_matrix),
            l=lower,
            u=upper,
            **problem["settings"],
        )
        result = model.solve()
    status_value = int(result.info.status_val)
    status_key, inaccurate, payload_kind = STATUS_BY_VALUE.get(
        status_value, ("unknown", False, "failure")
    )

    verification: dict[str, Any] = {
        "kind": "not_performed",
        "passed": False,
        "reason": f"status {status_key} has no accepted mathematical payload",
    }
    solution: dict[str, Any] | None = None
    certificate: dict[str, Any] | None = None

    if payload_kind == "solution":
        x = np.asarray(result.x, dtype=float)
        y = np.asarray(result.y, dtype=float)
        verification = verify_solution(
            np,
            problem,
            p_matrix,
            a_matrix,
            x,
            y,
            min_eigenvalue,
            psd_tolerance,
            verify_tolerance,
        )
        solution = {"x": _array_list(np, x), "y": _array_list(np, y)}
    elif payload_kind == "primal_certificate":
        values = result.prim_inf_cert
        verification = verify_primal_certificate(
            np, problem, a_matrix, values, verify_tolerance
        )
        certificate = {
            "type": "primal_infeasibility",
            "values": _array_list(np, values),
        }
    elif payload_kind == "dual_certificate":
        values = result.dual_inf_cert
        verification = verify_dual_certificate(
            np, problem, p_matrix, a_matrix, values, verify_tolerance
        )
        certificate = {"type": "dual_infeasibility", "values": _array_list(np, values)}

    accepted = _payload_is_accepted(
        payload_kind,
        bool(verification["passed"]),
        inaccurate,
        accept_inaccurate,
    )
    report = {
        "schema_version": SCHEMA_VERSION,
        "problem": {
            "name": problem["name"],
            "dimensions": problem["dimensions"],
            "structural_checks": problem["structural_checks"],
        },
        "solver": {
            "name": "OSQP",
            "version": getattr(osqp, "__version__", None),
        },
        "status": {
            "reported": str(result.info.status),
            "value": status_value,
            "classification": status_key,
            "inaccurate": inaccurate,
            "accepted": accepted,
            "accept_inaccurate_requested": accept_inaccurate,
        },
        "settings": problem["settings"],
        "statistics": _solver_statistics(result.info),
        "solution": solution,
        "certificate": certificate,
        "verification": verification,
    }
    return report, accepted


def _write_report(report: dict[str, Any], output: Path | None, indent: int) -> None:
    rendered = json.dumps(report, indent=indent, sort_keys=True, allow_nan=False)
    if output is not None:
        output.parent.mkdir(parents=True, exist_ok=True)
        file_descriptor, temporary_name = tempfile.mkstemp(
            dir=output.parent,
            prefix=f".{output.name}.",
            suffix=".tmp",
        )
        temporary_path = Path(temporary_name)
        try:
            with os.fdopen(file_descriptor, "w", encoding="utf-8") as handle:
                handle.write(rendered + "\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_path, output)
        except Exception:
            temporary_path.unlink(missing_ok=True)
            raise
    print(rendered)


def _error_report(kind: str, message: str) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "error": {"kind": kind, "message": message},
    }


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="JSON problem file")
    parser.add_argument("--output", type=Path, help="also write the JSON report here")
    parser.add_argument(
        "--verify-tol",
        type=float,
        default=1e-7,
        help="floor for independent residual/certificate checks",
    )
    parser.add_argument(
        "--accept-inaccurate",
        action="store_true",
        help="allow an inaccurate status only when independent checks pass",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="run dependency-free structural JSON checks without solving",
    )
    parser.add_argument("--indent", type=int, default=2, help="JSON indentation")
    args = parser.parse_args(argv)
    if not math.isfinite(args.verify_tol) or args.verify_tol <= 0:
        parser.error("--verify-tol must be finite and positive")
    if args.indent < 0:
        parser.error("--indent must be nonnegative")
    return args


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        args.input = args.input.expanduser().resolve(strict=False)
        if args.output is not None:
            args.output = args.output.expanduser().resolve(strict=False)
            same_file = args.input == args.output
            if args.output.exists() and args.input.exists():
                same_file = same_file or os.path.samefile(args.input, args.output)
            if same_file:
                raise InputError("--output must not resolve to the input file")
        problem = load_problem(args.input)
        if args.validate_only:
            report = {
                "schema_version": "osqp-solver-validation-v1",
                "valid": True,
                "problem": {
                    "name": problem["name"],
                    "dimensions": problem["dimensions"],
                    "structural_checks": problem["structural_checks"],
                },
                "note": (
                    "Structural validation only; PSD and numerical checks "
                    "require OSQP."
                ),
            }
            _write_report(report, args.output, args.indent)
            return 0

        report, accepted = solve_problem(
            problem,
            verify_tolerance=args.verify_tol,
            accept_inaccurate=args.accept_inaccurate,
        )
        _write_report(report, args.output, args.indent)
        return 0 if accepted else 3
    except InputError as exc:
        print(
            json.dumps(_error_report("input", str(exc)), indent=args.indent),
            file=sys.stderr,
        )
        return 2
    except DependencyError as exc:
        print(
            json.dumps(_error_report("dependency", str(exc)), indent=args.indent),
            file=sys.stderr,
        )
        return 2
    except Exception as exc:  # noqa: BLE001 - return a machine-readable solver error
        print(
            json.dumps(
                _error_report("solver", f"{type(exc).__name__}: {exc}"),
                indent=args.indent,
            ),
            file=sys.stderr,
        )
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
