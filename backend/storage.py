"""
Local-disk object storage.

This replaces the original storage.py, which proxied every photo upload/download
through Emergent's hosted object storage service (https://integrations.emergentagent.com),
requiring an EMERGENT_LLM_KEY and a dependency on a third-party SaaS.

Here, the same three functions (init_storage, put_object, get_object) are kept with
the same signatures so server.py and seed.py need no changes elsewhere -- only the
implementation is different: files are written to/read from a local directory, which
in docker-compose.yml is a named volume mounted at STORAGE_ROOT. That volume lives on
the NUC's own disk, so nothing leaves your network.
"""
import os
from pathlib import Path

APP_NAME = "dt-inspection"

STORAGE_ROOT = Path(os.environ.get("STORAGE_ROOT", "/data/uploads")).resolve()


def init_storage(force: bool = False):
    """Kept for API compatibility with server.py's startup hook. Just ensures the
    storage directory exists; there's no remote handshake/key to fetch anymore."""
    STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    return "local"


def _resolve(path: str) -> Path:
    """Resolve a storage-relative path safely, refusing anything that would escape
    STORAGE_ROOT (e.g. a path containing '..')."""
    full = (STORAGE_ROOT / path).resolve()
    if STORAGE_ROOT not in full.parents and full != STORAGE_ROOT:
        raise ValueError(f"Refusing to access path outside storage root: {path}")
    return full


def put_object(path: str, data: bytes, content_type: str) -> dict:
    init_storage()
    full = _resolve(path)
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_bytes(data)
    return {"path": path, "size": len(data)}


def get_object(path: str):
    full = _resolve(path)
    if not full.is_file():
        raise FileNotFoundError(f"No such object: {path}")
    # Content-Type isn't stored on disk separately -- server.py already keeps the
    # original content_type in the `files` Mongo collection and prefers that over
    # this fallback, so this generic value is only ever used if that record is missing.
    return full.read_bytes(), "application/octet-stream"
