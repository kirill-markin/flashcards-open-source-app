"""Strict JSON value helpers shared by historical monitoring evidence validators."""

from typing import TypeAlias

Json: TypeAlias = bool | int | float | str | None | list["Json"] | dict[str, "Json"]
CORE = "FlashcardsOpenSourceApp"
MONITORING = "FlashcardsOpenSourceAppMonitoring"


def object_value(value: Json, label: str) -> dict[str, Json]:
    if not isinstance(value, dict):
        raise ValueError(f"{label}: expected an object")
    return value


def text_value(value: Json, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{label}: expected a nonempty string")
    return value


def differences(before: Json, after: Json, path: str) -> list[str]:
    if isinstance(before, dict) and isinstance(after, dict):
        return [
            difference
            for key in sorted(before.keys() | after.keys())
            for difference in (
                [f"{path}/{key}"] if key not in before or key not in after
                else differences(before[key], after[key], f"{path}/{key}")
            )
        ]
    if isinstance(before, list) and isinstance(after, list) and len(before) == len(after):
        return [
            difference
            for index, (left, right) in enumerate(zip(before, after))
            for difference in differences(left, right, f"{path}/{index}")
        ]
    return [] if before == after else [path]


def require_equal(before: Json, after: Json, label: str) -> None:
    changed = differences(before, after, label)
    if changed:
        raise ValueError("Unexplained template delta at " + ", ".join(changed))

