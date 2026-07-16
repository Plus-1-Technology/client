from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


PREFIX = "window.KEEHN_LABEL_DATA="
ROOT = Path(__file__).resolve().parent
MODEL_PATHS = {
    "vendor_invoice": (
        ROOT / "vendor-invoice" / "data" / "vendor_invoice.data.js",
        ROOT / "vendor-invoice" / "exports" / "full-review-backup-vendor_invoice-db6f99eb1d69.json",
    ),
    "packing_slip_list": (
        ROOT / "packing-slip" / "data" / "packing_slip_list.data.js",
        ROOT / "packing-slip" / "exports" / "full-review-backup-packing_slip_list-db6f99eb1d69.json",
    ),
    "purchase_order": (
        ROOT / "purchase-order" / "data" / "purchase_order.data.js",
        ROOT / "purchase-order" / "exports" / "full-review-backup-purchase_order-db6f99eb1d69.json",
    ),
    "purchase_order_received_status": (
        ROOT / "purchase-order" / "data" / "purchase_order_received_status.data.js",
        ROOT / "purchase-order" / "exports" / "full-review-backup-purchase_order_received_status-db6f99eb1d69.json",
    ),
}


def load_bundle(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8").strip()
    if not text.startswith(PREFIX) or not text.endswith(";"):
        raise ValueError(f"Unsupported data bundle: {path}")
    return json.loads(text[len(PREFIX) : -1])


def merge_approved_checkpoint(baseline: dict[str, Any], checkpoint: dict[str, Any]) -> dict[str, Any]:
    if baseline.get("snapshot_id") != checkpoint.get("snapshot_id"):
        raise ValueError("Snapshot mismatch")
    fields = {
        (str(field.get("level")), str(field.get("name")))
        for field in baseline.get("fields") or []
    }
    for checkpoint_field in checkpoint.get("fields") or []:
        key = (str(checkpoint_field.get("level")), str(checkpoint_field.get("name")))
        if key not in fields:
            baseline.setdefault("fields", []).append(checkpoint_field)
            fields.add(key)
    documents = {str(document.get("file")): document for document in baseline.get("documents") or []}
    for approved in checkpoint.get("documents") or []:
        file_name = str(approved.get("file") or "")
        target = documents.get(file_name)
        if target is None:
            raise ValueError(f"Checkpoint document is absent from baseline: {file_name}")
        if approved.get("approved") is not True:
            raise ValueError(f"Checkpoint document is not approved: {file_name}")
        for label in approved.get("labels") or []:
            key = (str(label.get("level")), str(label.get("field")))
            if key not in fields:
                raise ValueError(f"Unknown field in {file_name}: {key}")
        target["labels"] = approved.get("labels") or []
        target["approved"] = True
        target["approved_at"] = approved.get("approved_at") or checkpoint.get("exported_at")
        target["notes"] = str(approved.get("notes") or "")
        target["suggestions"] = []
    return baseline


def apply_export(baseline: dict[str, Any], review_export: dict[str, Any]) -> dict[str, Any]:
    if baseline.get("model") != review_export.get("model"):
        raise ValueError("Model mismatch")
    if review_export.get("export_scope") == "approved_training_only":
        return merge_approved_checkpoint(baseline, review_export)
    if baseline.get("snapshot_id") != review_export.get("snapshot_id"):
        raise ValueError("Snapshot mismatch")
    expected = {str(document.get("file")) for document in baseline.get("documents") or []}
    actual = {str(document.get("file")) for document in review_export.get("documents") or []}
    if actual != expected:
        raise ValueError(
            f"Full-review document set mismatch; missing={sorted(expected-actual)}, extra={sorted(actual-expected)}"
        )
    return review_export


def main() -> int:
    parser = argparse.ArgumentParser(description="Update a Keehan label-review checkpoint")
    parser.add_argument("--review-export", type=Path, required=True)
    args = parser.parse_args()
    review_export = json.loads(args.review_export.read_text(encoding="utf-8"))
    model = str(review_export.get("model") or "")
    if model not in MODEL_PATHS:
        raise ValueError(f"Unsupported model: {model!r}")
    bundle_path, backup_path = MODEL_PATHS[model]
    merged = apply_export(load_bundle(bundle_path), review_export)
    compact = json.dumps(merged, ensure_ascii=False, separators=(",", ":"))
    bundle_path.write_text(f"{PREFIX}{compact};\n", encoding="utf-8")
    backup_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    result = {
        "model": model,
        "documents": len(merged.get("documents") or []),
        "approved": sum(document.get("approved") is True for document in merged.get("documents") or []),
        "labels": sum(len(document.get("labels") or []) for document in merged.get("documents") or []),
        "fields": len(merged.get("fields") or []),
    }
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
