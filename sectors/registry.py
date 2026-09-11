"""Registry capture, strict validation, profiling, and observed SCD2 history.

No network access occurs at import, replay, or on a cache miss without opt-in.
Only fetch_live reads credentials; request headers are never persisted or logged.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import time
import uuid

ENDPOINT = "https://api.sectors.app/v2/brokers/"
COHORTS = ("institutional", "retail", "mixed", "unknown")
FIELDS = {"code", "name", "is_foreign", "cohort", "license_type"}
RETRY_STATUSES = {408, 429, 500, 502, 503, 504}


class RegistryError(Exception):
    """Safe, actionable error text; never includes HTTP headers or body values."""


def canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      allow_nan=False)


def sha256(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def utc_timestamp(value: str) -> str:
    try:
        date = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if date.tzinfo is None:
            raise ValueError
        return date.astimezone(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")
    except (AttributeError, TypeError, ValueError, OverflowError):
        raise RegistryError("INVALID_TIMESTAMP: require an ISO-8601 timestamp with timezone") from None


def now_utc() -> str:
    return utc_timestamp(datetime.now(timezone.utc).isoformat())


@dataclass(frozen=True)
class Snapshot:
    snapshot_id: str
    retrieved_at: str
    endpoint: str
    http_status: int
    sha256: str
    source: str
    body: bytes

    def metadata(self) -> dict:
        # Deliberate allowlist. No request/response headers or environment values.
        return {key: getattr(self, key) for key in (
            "snapshot_id", "retrieved_at", "endpoint", "http_status", "sha256", "source"
        )}


def capture(cache: Path, body: bytes, *, retrieved_at: str, http_status: int,
            source: str) -> Snapshot:
    """Persist unchanged bytes first, including non-200/malformed responses."""
    stamp = utc_timestamp(retrieved_at)
    if type(http_status) is not int or not 100 <= http_status <= 599:
        raise RegistryError("INVALID_HTTP_STATUS")
    if source not in {"live", "local", "synthetic"}:
        raise RegistryError("INVALID_SNAPSHOT_SOURCE")
    snapshot = Snapshot(str(uuid.uuid4()), stamp, ENDPOINT, http_status,
                        sha256(body), source, body)
    directory = Path(cache) / snapshot.snapshot_id
    directory.mkdir(parents=True, exist_ok=False)
    (directory / "body.bin").write_bytes(body)
    # Manifest is the completion marker; incomplete captures cannot be replayed.
    temp = directory / "metadata.tmp"
    temp.write_text(canonical_json(snapshot.metadata()) + "\n", encoding="utf-8")
    temp.replace(directory / "metadata.json")
    return snapshot


def strict_json(body: bytes):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate JSON key")
            result[key] = value
        return result

    def invalid_constant(_):
        raise ValueError("non-finite JSON number")

    try:
        return json.loads(body.decode("utf-8"), object_pairs_hook=pairs,
                          parse_constant=invalid_constant)
    except (UnicodeError, ValueError, RecursionError):
        raise RegistryError("MALFORMED_JSON: expected UTF-8 JSON with unique object keys") from None


def load_snapshot(directory: Path) -> Snapshot:
    try:
        meta = strict_json((Path(directory) / "metadata.json").read_bytes())
        expected = {"snapshot_id", "retrieved_at", "endpoint", "http_status", "sha256", "source"}
        if not isinstance(meta, dict) or set(meta) != expected:
            raise RegistryError("INVALID_MANIFEST: unexpected or missing metadata fields")
        if str(uuid.UUID(meta["snapshot_id"])) != meta["snapshot_id"]:
            raise ValueError
        if meta["endpoint"] != ENDPOINT:
            raise RegistryError("INVALID_ENDPOINT: replay requires the unfiltered registry endpoint")
        if meta["source"] not in {"live", "local", "synthetic"}:
            raise ValueError
        if type(meta["http_status"]) is not int or not 100 <= meta["http_status"] <= 599:
            raise ValueError
        if not isinstance(meta["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", meta["sha256"]):
            raise ValueError
        meta["retrieved_at"] = utc_timestamp(meta["retrieved_at"])
        body = (Path(directory) / "body.bin").read_bytes()
        if sha256(body) != meta["sha256"]:
            raise RegistryError("CHECKSUM_MISMATCH: snapshot body differs from its manifest")
        return Snapshot(**meta, body=body)
    except (OSError, ValueError, TypeError, AttributeError):
        raise RegistryError("INVALID_SNAPSHOT: missing/unreadable body or invalid manifest") from None


def validate(snapshot: Snapshot) -> list[dict]:
    if sha256(snapshot.body) != snapshot.sha256:
        raise RegistryError("CHECKSUM_MISMATCH: snapshot body differs from its manifest")
    if snapshot.http_status != 200:
        raise RegistryError(f"HTTP_STATUS_{snapshot.http_status}: response archived; not registry data")
    rows = strict_json(snapshot.body)
    if not isinstance(rows, list):
        raise RegistryError("INVALID_SOURCE_SHAPE: registry must be a top-level array")
    problems = []
    seen = set()
    for index, row in enumerate(rows):
        prefix = f"row[{index}]"
        if not isinstance(row, dict):
            problems.append(f"{prefix}: EXPECTED_OBJECT")
            continue
        if set(row) != FIELDS:
            problems.append(f"{prefix}: UNEXPECTED_OR_MISSING_FIELDS")
        for field in ("code", "name"):
            value = row.get(field)
            if not isinstance(value, str) or not value.strip() or value != value.strip():
                problems.append(f"{prefix}.{field}: EXPECTED_NONEMPTY_TRIMMED_STRING")
        code = row.get("code")
        if isinstance(code, str):
            if code in seen:
                problems.append(f"{prefix}.code: DUPLICATE_BROKER_CODE")
            seen.add(code)
        if type(row.get("is_foreign")) is not bool:
            problems.append(f"{prefix}.is_foreign: EXPECTED_BOOLEAN")
        cohort = row.get("cohort")
        if cohort is not None and (not isinstance(cohort, str) or cohort not in COHORTS):
            problems.append(f"{prefix}.cohort: UNEXPECTED_COHORT")
        if row.get("license_type") is not None and not isinstance(row["license_type"], str):
            problems.append(f"{prefix}.license_type: EXPECTED_STRING_OR_NULL")
    if problems:
        raise RegistryError("VALIDATION_FAILED: " + "; ".join(problems))
    return rows  # Raw values retained; no mutations or normalization here.


def profile(rows: list[dict]) -> dict:
    counts = Counter(row["cohort"] if row["cohort"] is not None else "unknown" for row in rows)
    total = len(rows)
    return {
        "measure": "registry shares (not trading coverage)",
        "broker_count": total,
        "cohorts": {cohort: {"broker_count": counts[cohort],
                             "registry_share": counts[cohort] / total if total else None}
                    for cohort in COHORTS},
        "reason_code": None if total else "EMPTY_REGISTRY",
    }


def tracked_attributes(row: dict) -> dict:
    return {"broker_name": row["name"], "is_foreign": row["is_foreign"],
            "cohort": row["cohort"] if row["cohort"] is not None else "unknown",
            "license_type": row["license_type"]}


def connect(path: Path) -> sqlite3.Connection:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.executescript(Path(__file__).with_name("schema.sql").read_text(encoding="utf-8"))
    return connection


def refresh(connection: sqlite3.Connection, snapshot: Snapshot) -> dict:
    rows = validate(snapshot)
    if not rows:
        raise RegistryError("EMPTY_REGISTRY: profile allowed; dimension refresh refused")
    # BEGIN IMMEDIATE serializes writers before any history checks.
    connection.execute("BEGIN IMMEDIATE")
    try:
        previous = connection.execute(
            "SELECT * FROM registry_snapshot WHERE snapshot_id = ?", (snapshot.snapshot_id,)
        ).fetchone()
        if previous:
            if dict(previous) != snapshot.metadata():
                raise RegistryError("SNAPSHOT_ID_CONFLICT: applied snapshot identity changed")
            connection.commit()
            return {"already_applied": True, "inserted_versions": 0, "changed_brokers": 0,
                    "missing_brokers_retained": []}
        latest = connection.execute("SELECT MAX(retrieved_at) FROM registry_snapshot").fetchone()[0]
        if latest is not None and snapshot.retrieved_at <= latest:
            raise RegistryError("OUT_OF_ORDER_SNAPSHOT: new snapshots must be strictly later than the last applied snapshot")
        sources = {r[0] for r in connection.execute("SELECT DISTINCT source FROM registry_snapshot")}
        if sources and (("synthetic" in sources) != (snapshot.source == "synthetic")):
            raise RegistryError("MIXED_PROVENANCE: use separate databases for synthetic and real observations")
        connection.execute(
            "INSERT INTO registry_snapshot VALUES (?, ?, ?, ?, ?, ?)",
            tuple(snapshot.metadata().values()),
        )
        current = {r["broker_code"]: r for r in connection.execute(
            "SELECT * FROM dim_broker WHERE valid_to IS NULL")}
        inserted = changed = 0
        for row in rows:
            code = row["code"]
            attrs = tracked_attributes(row)
            attr_hash = sha256(canonical_json(attrs).encode("utf-8"))
            old = current.get(code)
            if old is not None and old["attribute_hash"] == attr_hash:
                continue
            if old is not None:
                connection.execute("UPDATE dim_broker SET valid_to = ? WHERE broker_version_id = ?",
                                   (snapshot.retrieved_at, old["broker_version_id"]))
                changed += 1
            version_id = sha256(canonical_json([code, snapshot.retrieved_at, attr_hash]).encode("utf-8"))
            connection.execute(
                """INSERT INTO dim_broker (broker_version_id, broker_code, broker_name,
                is_foreign, cohort, license_type, valid_from, valid_to, source_snapshot_id,
                attribute_hash) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)""",
                (version_id, code, attrs["broker_name"], int(attrs["is_foreign"]), attrs["cohort"],
                 attrs["license_type"], snapshot.retrieved_at, snapshot.snapshot_id, attr_hash),
            )
            inserted += 1
        missing = sorted(set(current) - {row["code"] for row in rows})
        connection.commit()
        return {"already_applied": False, "inserted_versions": inserted, "changed_brokers": changed,
                "missing_brokers_retained": missing}
    except BaseException:
        connection.rollback()
        raise


def retry_delay(header: str | None, attempt: int) -> float | None:
    """None means stop rather than retry earlier than a long Retry-After."""
    delay = min(2 ** attempt, 8)
    if header:
        try:
            server_delay = float(header)
            if not math.isfinite(server_delay):
                raise ValueError
        except ValueError:
            try:
                server_delay = (parsedate_to_datetime(header) - datetime.now(timezone.utc)).total_seconds()
            except (TypeError, ValueError, OverflowError):
                server_delay = 0
        delay = max(delay, server_delay)
    return None if delay > 30 else delay


def fetch_live(cache: Path, *, timeout: float = 15, retries: int = 2,
               get=None, sleep=time.sleep) -> Snapshot:
    if not math.isfinite(timeout) or not 0 < timeout <= 60 or not 0 <= retries <= 3:
        raise RegistryError("INVALID_FETCH_OPTIONS: timeout must be (0, 60]; retries 0..3")
    key = os.environ.get("SECTORS_API_KEY")
    if not key:
        raise RegistryError("MISSING_API_KEY: set SECTORS_API_KEY in the environment for explicit live fetch")
    if key != key.strip() or any(ord(c) < 33 or ord(c) > 126 for c in key):
        raise RegistryError("INVALID_API_KEY_FORMAT")
    # Keep offline replay dependency-free. Match a normal requests.get client;
    # do not override its User-Agent, proxy, TLS, or adapter configuration.
    try:
        import requests
    except ImportError:
        raise RegistryError("MISSING_HTTP_DEPENDENCY: install requests with python -m pip install -r requirements.txt") from None
    get = get or requests.get
    for attempt in range(retries + 1):
        try:
            # Refuse redirects as before, so Authorization is never forwarded.
            with get(ENDPOINT, headers={"Authorization": key, "Accept": "application/json"},
                     timeout=timeout, allow_redirects=False) as response:
                status = response.status_code
                body = response.content  # Bytes, not .text or parsed/re-serialized JSON.
                retry_after = response.headers.get("Retry-After")
        except (requests.RequestException, OSError):
            # Do not echo exception text: proxies/servers may reflect credentials.
            if attempt == retries:
                raise RegistryError("FETCH_TRANSPORT_FAILED: bounded retries exhausted; no complete response captured") from None
            sleep(min(2 ** attempt, 8))
            continue
        # Storage errors must not trigger another paid request.
        # Unaltered response is on disk before any interpretation.
        snapshot = capture(cache, body, retrieved_at=now_utc(), http_status=status, source="live")
        if status == 200:
            try:
                validate(snapshot)  # Malformed success is archived and never retried.
            except RegistryError as exc:
                raise RegistryError(f"{exc}; response archived as {snapshot.snapshot_id}") from None
            return snapshot
        delay = retry_delay(retry_after, attempt)
        if status not in RETRY_STATUSES or attempt == retries or delay is None:
            raise RegistryError(f"HTTP_STATUS_{status}: response archived as {snapshot.snapshot_id}; fetch stopped")
        sleep(delay)
    raise AssertionError("unreachable")


def cached_snapshot(cache: Path) -> tuple[Snapshot | None, list[str]]:
    candidates = []
    warnings = []
    for directory in sorted(Path(cache).glob("*")):
        if not directory.is_dir():
            continue
        try:
            snapshot = load_snapshot(directory)
            rows = validate(snapshot)
            if not rows:
                raise RegistryError("EMPTY_REGISTRY")
            candidates.append(snapshot)
        except RegistryError as exc:
            warnings.append(str(exc))
    return max(candidates, key=lambda s: (s.retrieved_at, s.snapshot_id), default=None), warnings


def acquire(cache: Path, *, snapshot_path: Path | None = None, live: bool = False,
            force_refresh: bool = False, timeout: float = 15, retries: int = 2) -> tuple[Snapshot, list[str]]:
    if snapshot_path is not None:
        if live or force_refresh:
            raise RegistryError("INVALID_OPTIONS: snapshot replay cannot use live/refresh")
        return load_snapshot(snapshot_path), []
    if force_refresh and not live:
        raise RegistryError("INVALID_OPTIONS: --refresh requires --live")
    cached, warnings = cached_snapshot(cache)
    if cached is not None and not force_refresh:
        return cached, warnings
    if not live:
        raise RegistryError("NO_VALID_CACHE: replay --snapshot or explicitly opt in with --live")
    return fetch_live(cache, timeout=timeout, retries=retries), warnings
