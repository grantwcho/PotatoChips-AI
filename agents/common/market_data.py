from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Iterable

import pandas as pd

SUPPORTED_MARKET_DATA_PROVIDERS = ("alpaca", "alpha_vantage", "yfinance")
DEFAULT_MARKET_DATA_PROVIDERS = ("alpaca", "alpha_vantage", "yfinance")

ALPACA_DATA_ENDPOINT = "https://data.alpaca.markets"
ALPHA_VANTAGE_ENDPOINT = "https://www.alphavantage.co"

ALPHA_VANTAGE_INDEX_SYMBOLS = {
    "^VIX": "VIX",
    "^VIX3M": "VIX3M",
}


class MarketDataProviderError(RuntimeError):
    """Raised when a provider cannot satisfy a market-data request."""


def configured_market_data_providers() -> list[str]:
    raw = (
        os.environ.get("AGENT_MARKET_DATA_PROVIDERS")
        or os.environ.get("PYTHON_TRADING_AGENT_MARKET_DATA_PROVIDERS")
        or ""
    ).strip()

    if not raw:
        return list(DEFAULT_MARKET_DATA_PROVIDERS)

    providers: list[str] = []
    for value in raw.split(","):
        normalized = value.strip().lower().replace("-", "_")
        if normalized in SUPPORTED_MARKET_DATA_PROVIDERS and normalized not in providers:
            providers.append(normalized)

    return providers or list(DEFAULT_MARKET_DATA_PROVIDERS)


def configured_market_data_source_labels() -> list[str]:
    labels = {
        "alpaca": "alpaca",
        "alpha_vantage": "alpha_vantage",
        "yfinance": "yfinance",
    }
    return [labels[provider] for provider in configured_market_data_providers()]


def fetch_symbol_ohlcv_history(
    symbol: str,
    *,
    start: str | None = None,
    end: str | None = None,
    calendar_days: int | None = None,
) -> tuple[pd.DataFrame, str]:
    normalized_symbol = _normalize_symbol(symbol)
    errors: list[str] = []

    for provider in configured_market_data_providers():
        try:
            if provider == "alpaca":
                return _fetch_symbol_from_alpaca(
                    normalized_symbol,
                    start=start,
                    end=end,
                    calendar_days=calendar_days,
                ), provider
            if provider == "alpha_vantage":
                return _fetch_symbol_from_alpha_vantage(
                    normalized_symbol,
                    start=start,
                    end=end,
                    calendar_days=calendar_days,
                ), provider
            if provider == "yfinance":
                return _fetch_symbol_from_yfinance(
                    normalized_symbol,
                    start=start,
                    end=end,
                    calendar_days=calendar_days,
                ), provider
        except MarketDataProviderError as error:
            errors.append(f"{provider}: {error}")

    raise RuntimeError(
        f"Unable to fetch market data for {normalized_symbol}. "
        + (" Tried " + "; ".join(errors) if errors else "No providers were configured.")
    )


def fetch_universe_ohlcv_history(
    symbols: Iterable[str],
    *,
    start: str | None = None,
    end: str | None = None,
    calendar_days: int | None = None,
) -> tuple[dict[str, pd.DataFrame], dict[str, str]]:
    frames: dict[str, pd.DataFrame] = {}
    providers_by_symbol: dict[str, str] = {}

    for symbol in _dedupe_symbols(symbols):
        frame, provider = fetch_symbol_ohlcv_history(
            symbol,
            start=start,
            end=end,
            calendar_days=calendar_days,
        )
        if not frame.empty:
            frames[symbol] = frame
            providers_by_symbol[symbol] = provider

    return frames, providers_by_symbol


def fetch_close_history(
    symbols: Iterable[str],
    *,
    start: str | None = None,
    end: str | None = None,
    calendar_days: int | None = None,
) -> tuple[pd.DataFrame, dict[str, str]]:
    frames, providers_by_symbol = fetch_universe_ohlcv_history(
        symbols,
        start=start,
        end=end,
        calendar_days=calendar_days,
    )

    close_columns = [
        frames[symbol]["Close"].rename(symbol)
        for symbol in _dedupe_symbols(symbols)
        if symbol in frames and "Close" in frames[symbol]
    ]
    if not close_columns:
        return pd.DataFrame(), providers_by_symbol

    dataset = pd.concat(close_columns, axis=1).sort_index().ffill()
    dataset.columns = [str(column).upper() for column in dataset.columns]
    dataset = dataset.dropna(axis=1, how="all")
    return dataset, providers_by_symbol


def _fetch_symbol_from_alpaca(
    symbol: str,
    *,
    start: str | None,
    end: str | None,
    calendar_days: int | None,
) -> pd.DataFrame:
    if symbol.startswith("^"):
        raise MarketDataProviderError("symbol is not a US stock/ETF ticker supported by Alpaca.")

    api_key = os.environ.get("ALPACA_API_KEY", "").strip()
    secret_key = os.environ.get("ALPACA_SECRET_KEY", "").strip()
    if not api_key or not secret_key:
        raise MarketDataProviderError("credentials are not configured.")

    start_iso, end_iso = _resolve_request_window(start=start, end=end, calendar_days=calendar_days)
    params = urllib.parse.urlencode(
        {
            "timeframe": "1Day",
            "start": start_iso,
            "end": end_iso,
            "adjustment": "all",
            "limit": "10000",
        }
    )
    request = urllib.request.Request(
        f"{ALPACA_DATA_ENDPOINT}/v2/stocks/{urllib.parse.quote(symbol)}/bars?{params}",
        headers={
            "accept": "application/json",
            "APCA-API-KEY-ID": api_key,
            "APCA-API-SECRET-KEY": secret_key,
        },
    )

    payload = _load_json_response(request, "Alpaca")
    bars = payload.get("bars")
    if not isinstance(bars, list) or not bars:
        raise MarketDataProviderError("returned no daily bars.")

    frame = _frame_from_records(
        bars,
        field_map={
            "timestamp": "t",
            "Open": "o",
            "High": "h",
            "Low": "l",
            "Close": "c",
            "Volume": "v",
        },
    )
    if frame.empty:
        raise MarketDataProviderError("returned no usable daily bars.")
    return frame


def _fetch_symbol_from_alpha_vantage(
    symbol: str,
    *,
    start: str | None,
    end: str | None,
    calendar_days: int | None,
) -> pd.DataFrame:
    api_key = os.environ.get("ALPHA_VANTAGE_API_KEY", "").strip() or os.environ.get(
        "ALPHA_VANTAGE_KEY", ""
    ).strip()
    if not api_key:
        raise MarketDataProviderError("API key is not configured.")

    endpoint = os.environ.get("ALPHA_VANTAGE_ENDPOINT", "").strip() or ALPHA_VANTAGE_ENDPOINT
    normalized_symbol = ALPHA_VANTAGE_INDEX_SYMBOLS.get(symbol, symbol)
    params = {
        "apikey": api_key,
        "datatype": "json",
    }

    if normalized_symbol in ALPHA_VANTAGE_INDEX_SYMBOLS.values():
        params.update(
            {
                "function": "INDEX_DATA",
                "symbol": normalized_symbol,
                "interval": "daily",
            }
        )
    else:
        params.update(
            {
                "function": "TIME_SERIES_DAILY_ADJUSTED",
                "symbol": normalized_symbol,
                "outputsize": _alpha_vantage_outputsize(
                    start=start,
                    end=end,
                    calendar_days=calendar_days,
                ),
            }
        )

    request = urllib.request.Request(
        f"{endpoint.rstrip('/')}/query?{urllib.parse.urlencode(params)}",
        headers={"accept": "application/json"},
    )
    payload = _load_json_response(request, "Alpha Vantage")
    if "Time Series (Daily)" in payload:
        frame = _frame_from_alpha_vantage_daily(payload["Time Series (Daily)"])
    elif isinstance(payload.get("data"), list):
        frame = _frame_from_records(
            payload["data"],
            field_map={
                "timestamp": "date",
                "Open": "open",
                "High": "high",
                "Low": "low",
                "Close": "close",
                "Volume": "volume",
            },
        )
    else:
        key = next(
            (candidate for candidate in payload if str(candidate).lower().startswith("time series")),
            None,
        )
        if key is None:
            raise MarketDataProviderError("returned an unexpected response shape.")
        frame = _frame_from_alpha_vantage_daily(payload[key])

    filtered = _filter_frame_to_window(frame, start=start, end=end)
    if filtered.empty:
        raise MarketDataProviderError("returned no usable daily bars.")
    return filtered


def _fetch_symbol_from_yfinance(
    symbol: str,
    *,
    start: str | None,
    end: str | None,
    calendar_days: int | None,
) -> pd.DataFrame:
    try:
        import yfinance as yf
    except ModuleNotFoundError as error:
        raise MarketDataProviderError("package is not installed.") from error

    download_kwargs: dict[str, object] = {
        "tickers": symbol,
        "interval": "1d",
        "auto_adjust": True,
        "progress": False,
        "threads": False,
    }
    if start is not None or end is not None:
        if start is not None:
            download_kwargs["start"] = start
        if end is not None:
            download_kwargs["end"] = (pd.Timestamp(end) + pd.Timedelta(days=1)).date().isoformat()
    else:
        download_kwargs["period"] = f"{max(calendar_days or 365, 30)}d"

    dataset = yf.download(**download_kwargs)
    if dataset.empty:
        raise MarketDataProviderError("returned no daily bars.")

    required_fields = ["Open", "High", "Low", "Close"]
    if isinstance(dataset.columns, pd.MultiIndex):
        frame = pd.DataFrame(
            {
                field: dataset[field][symbol]
                for field in required_fields
                if field in dataset.columns.get_level_values(0) and symbol in dataset[field]
            }
        )
        if "Volume" in dataset.columns.get_level_values(0) and symbol in dataset["Volume"]:
            frame["Volume"] = dataset["Volume"][symbol]
    else:
        available_fields = [field for field in required_fields if field in dataset]
        frame = dataset[available_fields].copy()
        if "Volume" in dataset:
            frame["Volume"] = dataset["Volume"]

    frame = _normalize_price_frame(frame)
    if frame.empty:
        raise MarketDataProviderError("returned no usable daily bars.")
    return frame


def _load_json_response(request: urllib.request.Request, provider_name: str) -> dict[str, object]:
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="ignore").strip()
        raise MarketDataProviderError(
            f"HTTP {error.code}{': ' + detail if detail else ''}"
        ) from error
    except urllib.error.URLError as error:
        raise MarketDataProviderError(
            error.reason if isinstance(error.reason, str) else "request failed."
        ) from error
    except json.JSONDecodeError as error:
        raise MarketDataProviderError("returned invalid JSON.") from error

    if not isinstance(payload, dict):
        raise MarketDataProviderError("returned a non-object payload.")

    for key in ("Error Message", "Information", "Note", "message"):
        detail = payload.get(key)
        if isinstance(detail, str) and detail.strip():
            raise MarketDataProviderError(detail.strip())

    return payload


def _frame_from_alpha_vantage_daily(series: object) -> pd.DataFrame:
    if not isinstance(series, dict):
        return pd.DataFrame()

    rows: list[dict[str, object]] = []
    for timestamp, record in series.items():
        if not isinstance(record, dict):
            continue

        close = _coerce_float(record.get("4. close") or record.get("close"))
        adjusted_close = _coerce_float(
            record.get("5. adjusted close") or record.get("adjusted close")
        )
        open_price = _coerce_float(record.get("1. open") or record.get("open"))
        high_price = _coerce_float(record.get("2. high") or record.get("high"))
        low_price = _coerce_float(record.get("3. low") or record.get("low"))
        volume = _coerce_float(record.get("6. volume") or record.get("volume"))

        if close is None:
            continue

        adjustment_factor = (adjusted_close / close) if adjusted_close is not None and close else 1.0
        rows.append(
            {
                "timestamp": timestamp,
                "Open": open_price * adjustment_factor if open_price is not None else None,
                "High": high_price * adjustment_factor if high_price is not None else None,
                "Low": low_price * adjustment_factor if low_price is not None else None,
                "Close": adjusted_close if adjusted_close is not None else close,
                "Volume": volume,
            }
        )

    return _normalize_price_frame(pd.DataFrame(rows).set_index("timestamp") if rows else pd.DataFrame())


def _frame_from_records(
    records: list[object],
    *,
    field_map: dict[str, str],
) -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    for record in records:
        if not isinstance(record, dict):
            continue

        timestamp = record.get(field_map["timestamp"])
        close = _coerce_float(record.get(field_map["Close"]))
        if timestamp is None or close is None:
            continue

        row = {
            "timestamp": timestamp,
            "Open": _coerce_float(record.get(field_map["Open"])),
            "High": _coerce_float(record.get(field_map["High"])),
            "Low": _coerce_float(record.get(field_map["Low"])),
            "Close": close,
        }
        volume_field = field_map.get("Volume")
        if volume_field:
            row["Volume"] = _coerce_float(record.get(volume_field))
        rows.append(row)

    return _normalize_price_frame(pd.DataFrame(rows).set_index("timestamp") if rows else pd.DataFrame())


def _normalize_price_frame(frame: pd.DataFrame) -> pd.DataFrame:
    if frame.empty:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close"])

    normalized = frame.copy()
    normalized.index = [
        _normalize_daily_timestamp(index)
        for index in normalized.index
    ]
    normalized.index = pd.DatetimeIndex(normalized.index)
    normalized = normalized.sort_index()

    for field in ("Open", "High", "Low", "Close", "Volume"):
        if field in normalized:
            normalized[field] = pd.to_numeric(normalized[field], errors="coerce")

    normalized = normalized[~normalized.index.duplicated(keep="last")]
    normalized = normalized.ffill().dropna(subset=["Close"], how="all")
    for field in ("Open", "High", "Low"):
        if field in normalized:
            normalized[field] = normalized[field].fillna(normalized["Close"])

    columns = [field for field in ("Open", "High", "Low", "Close", "Volume") if field in normalized]
    return normalized[columns]


def _normalize_daily_timestamp(value: object) -> pd.Timestamp:
    timestamp = pd.to_datetime(value, utc=True, errors="coerce")
    if pd.isna(timestamp):
        timestamp = pd.to_datetime(value, errors="coerce")
    if pd.isna(timestamp):
        raise ValueError(f"Invalid market-data timestamp: {value}")
    if getattr(timestamp, "tzinfo", None) is not None:
        timestamp = timestamp.tz_convert(None)
    return pd.Timestamp(timestamp).normalize()


def _resolve_request_window(
    *,
    start: str | None,
    end: str | None,
    calendar_days: int | None,
) -> tuple[str, str]:
    if start is None and end is None:
        requested_days = max(calendar_days or 365, 30)
        end_dt = datetime.now(timezone.utc)
        start_dt = end_dt - timedelta(days=requested_days)
    else:
        start_dt = _parse_boundary(start, boundary="start") if start else None
        end_dt = _parse_boundary(end, boundary="end") if end else datetime.now(timezone.utc)
        if start_dt is None:
            requested_days = max(calendar_days or 365, 30)
            start_dt = end_dt - timedelta(days=requested_days)

    return start_dt.isoformat().replace("+00:00", "Z"), end_dt.isoformat().replace("+00:00", "Z")


def _filter_frame_to_window(
    frame: pd.DataFrame,
    *,
    start: str | None,
    end: str | None,
) -> pd.DataFrame:
    filtered = frame
    if start:
        filtered = filtered.loc[filtered.index >= _normalize_daily_timestamp(start)]
    if end:
        filtered = filtered.loc[filtered.index <= _normalize_daily_timestamp(end)]
    return filtered


def _parse_boundary(value: str, *, boundary: str) -> datetime:
    raw = value.strip()
    if _is_date_only(raw):
        suffix = "00:00:00+00:00" if boundary == "start" else "23:59:59+00:00"
        return datetime.fromisoformat(f"{raw}T{suffix}")

    parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _alpha_vantage_outputsize(
    *,
    start: str | None,
    end: str | None,
    calendar_days: int | None,
) -> str:
    estimated_days = calendar_days
    if estimated_days is None and start and end:
        estimated_days = max((_parse_boundary(end, boundary="end") - _parse_boundary(start, boundary="start")).days, 0)
    return "full" if (estimated_days or 0) > 110 else "compact"


def _normalize_symbol(symbol: str) -> str:
    normalized = symbol.strip().upper()
    if not normalized:
        raise ValueError("Symbol cannot be empty.")
    return normalized


def _dedupe_symbols(symbols: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(_normalize_symbol(symbol) for symbol in symbols))


def _coerce_float(value: object) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _is_date_only(value: str) -> bool:
    return len(value) == 10 and value[4] == "-" and value[7] == "-"
