"""
SIEM Use case workbook API — persisted in SQLite (shared team workbook).

Endpoints (mounted at /api/siem-workbook):

  GET    /api/siem-workbook          load workbook JSON
  PUT    /api/siem-workbook          save workbook JSON
  DELETE /api/siem-workbook          clear workbook

Requires authenticated session (same as daily/weekly report APIs).
"""
from __future__ import annotations

import json
from typing import Any

from flask import Blueprint, jsonify, request, g
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from db import SessionLocal
from auth.session import require_auth
from models.db_models import SiemWorkbookStore

siem_workbook_bp = Blueprint("siem_workbook", __name__)

WORKBOOK_ID = "default"
MAX_WORKBOOK_BYTES = 12 * 1024 * 1024  # 12 MiB JSON cap


def _empty_workbook() -> dict[str, Any]:
    return {"sheets": [], "activeSheetIndex": 0}


def _serialise_row(row: SiemWorkbookStore | None) -> dict[str, Any]:
    if row is None:
        return {**_empty_workbook(), "updatedAt": None, "updatedBy": None}
    try:
        data = json.loads(row.workbook_json or "{}")
    except json.JSONDecodeError:
        data = _empty_workbook()
    if not isinstance(data, dict):
        data = _empty_workbook()
    sheets = data.get("sheets")
    if not isinstance(sheets, list):
        sheets = []
    idx = data.get("activeSheetIndex", 0)
    if not isinstance(idx, int):
        idx = 0
    updated_by = None
    if row.updated_by_user is not None:
        updated_by = row.updated_by_user.email
    return {
        "sheets": sheets,
        "activeSheetIndex": max(0, idx),
        "updatedAt": row.updated_at.isoformat() + "Z" if row.updated_at else None,
        "updatedBy": updated_by,
    }


def _validate_workbook_payload(body: dict[str, Any]) -> dict[str, Any]:
    sheets = body.get("sheets")
    if not isinstance(sheets, list):
        raise ValueError("sheets must be an array")
    idx = body.get("activeSheetIndex", 0)
    if isinstance(idx, bool) or not isinstance(idx, (int, float)):
        raise ValueError("activeSheetIndex must be an integer")
    idx = int(idx)
    if idx < 0:
        idx = 0
    if sheets and idx >= len(sheets):
        idx = len(sheets) - 1
    # Shallow structural check per sheet
    for i, s in enumerate(sheets):
        if not isinstance(s, dict):
            raise ValueError(f"sheets[{i}] must be an object")
        if not isinstance(s.get("name"), str):
            raise ValueError(f"sheets[{i}].name must be a string")
        if not isinstance(s.get("columns"), list):
            raise ValueError(f"sheets[{i}].columns must be an array")
        if not isinstance(s.get("rows"), list):
            raise ValueError(f"sheets[{i}].rows must be an array")
    normalised = {"sheets": sheets, "activeSheetIndex": idx}
    encoded = json.dumps(normalised, ensure_ascii=False)
    if len(encoded.encode("utf-8")) > MAX_WORKBOOK_BYTES:
        raise ValueError("Workbook too large to save (max 12 MB)")
    return normalised


@siem_workbook_bp.get("")
@require_auth
def get_workbook():
    with SessionLocal() as db:
        row = db.execute(
            select(SiemWorkbookStore)
            .where(SiemWorkbookStore.id == WORKBOOK_ID)
            .options(joinedload(SiemWorkbookStore.updated_by_user))
        ).scalar_one_or_none()
        return jsonify(_serialise_row(row))


@siem_workbook_bp.put("")
@require_auth
def put_workbook():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "JSON body required"}), 400
    try:
        normalised = _validate_workbook_payload(body)
    except ValueError as ex:
        return jsonify({"error": str(ex)}), 400

    user = g.current_user
    payload = json.dumps(normalised, ensure_ascii=False)

    with SessionLocal() as db:
        row = db.execute(
            select(SiemWorkbookStore).where(SiemWorkbookStore.id == WORKBOOK_ID)
        ).scalar_one_or_none()
        if row is None:
            row = SiemWorkbookStore(
                id=WORKBOOK_ID,
                workbook_json=payload,
                updated_by_user_id=user.id if user else None,
            )
            db.add(row)
        else:
            row.workbook_json = payload
            row.updated_by_user_id = user.id if user else None
        db.commit()
        row = db.execute(
            select(SiemWorkbookStore)
            .where(SiemWorkbookStore.id == WORKBOOK_ID)
            .options(joinedload(SiemWorkbookStore.updated_by_user))
        ).scalar_one()
        return jsonify(_serialise_row(row))


@siem_workbook_bp.delete("")
@require_auth
def delete_workbook():
    with SessionLocal() as db:
        row = db.execute(
            select(SiemWorkbookStore).where(SiemWorkbookStore.id == WORKBOOK_ID)
        ).scalar_one_or_none()
        if row:
            db.delete(row)
            db.commit()
    return jsonify({"ok": True, **_empty_workbook()})
