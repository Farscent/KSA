"""Load the frozen demo scope locally; no calendar expansion or acquisition."""

from dataclasses import dataclass
from datetime import date
from pathlib import Path
import re

from .registry import RegistryError, strict_json

CONFIG_PATH = Path(__file__).with_name("demo-scope.json")


@dataclass(frozen=True)
class DemoScope:
    symbols: tuple[str, ...]
    end_date: date
    lookback_trading_days: int


def load_demo_scope(path: Path = CONFIG_PATH) -> DemoScope:
    """Validate local configuration and return immutable values.

    The checked-in JSON is the sole runtime source of approved scope values.
    Regression tests pin that decision; loading validates shape and types only,
    not whether the date is an IDX trading date. No start date is inferred.
    """
    try:
        config = strict_json(Path(path).read_bytes())
    except (OSError, RegistryError) as exc:
        raise ValueError("INVALID_DEMO_CONFIG: cannot read valid JSON") from exc
    if not isinstance(config, dict) or set(config) != {"symbols", "end_date", "lookback_trading_days"}:
        raise ValueError("INVALID_DEMO_CONFIG: expected symbols, end_date and lookback_trading_days")
    symbols = config["symbols"]
    if (not isinstance(symbols, list) or len(symbols) != 10
            or any(not isinstance(symbol, str) or not re.fullmatch(r"[A-Z]+", symbol) for symbol in symbols)
            or len(set(symbols)) != 10 or "BBCA" not in symbols):
        raise ValueError("INVALID_DEMO_CONFIG: require 10 unique uppercase symbols including BBCA")
    try:
        end_date = date.fromisoformat(config["end_date"])
        if end_date.isoformat() != config["end_date"]:
            raise ValueError
    except (TypeError, ValueError) as exc:
        raise ValueError("INVALID_DEMO_CONFIG: end_date must be a YYYY-MM-DD date") from exc
    lookback = config["lookback_trading_days"]
    if type(lookback) is not int or lookback <= 0:
        raise ValueError("INVALID_DEMO_CONFIG: lookback_trading_days must be a positive integer")
    return DemoScope(tuple(symbols), end_date, lookback)
