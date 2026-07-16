from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PREFIX = "window.KEEHN_LABEL_DATA="
ROOT = Path(__file__).resolve().parent
DATA_FILES = {
    "vendor_invoice": ROOT / "vendor-invoice" / "data" / "vendor_invoice.data.js",
    "packing_slip_list": ROOT / "packing-slip" / "data" / "packing_slip_list.data.js",
    "purchase_order": ROOT / "purchase-order" / "data" / "purchase_order.data.js",
    "purchase_order_received_status": ROOT / "purchase-order" / "data" / "purchase_order_received_status.data.js",
}


def load_bundle(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8").strip()
    return json.loads(text[len(PREFIX) : -1])


def main() -> int:
    models: dict[str, Any] = {}
    for model, path in DATA_FILES.items():
        data = load_bundle(path)
        documents = data.get("documents") or []
        models[model] = {
            "documents": len(documents),
            "approved": sum(document.get("approved") is True for document in documents),
            "labels": sum(len(document.get("labels") or []) for document in documents),
            "fields": len(data.get("fields") or []),
            "pages": sum(len(document.get("pages") or []) for document in documents),
            "suggestions": sum(len(document.get("suggestions") or []) for document in documents),
        }
    files = []
    for path in sorted(item for item in ROOT.rglob("*") if item.is_file() and item.name != "MANIFEST.json"):
        payload = path.read_bytes()
        files.append({
            "path": path.relative_to(ROOT).as_posix(),
            "bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
        })
    manifest = {
        "manifest_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "snapshot_id": "db6f99eb1d694ddd7b0c498a371b4d19016eb9eb5b5f904838e1281a39e29e71",
        "public_site": "https://plus-1-technology.github.io/client/Keehan-DI-Label-Review/",
        "models": models,
        "file_count": len(files),
        "package_bytes": sum(file["bytes"] for file in files),
        "files": files,
        "azure_changed": False,
        "model_trained": False,
    }
    (ROOT / "MANIFEST.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"models": models, "file_count": len(files), "package_bytes": manifest["package_bytes"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
