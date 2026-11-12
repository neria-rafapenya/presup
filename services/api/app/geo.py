"""Deterministic, POC-level distance checks for service coverage."""

from math import asin, cos, radians, sin, sqrt
import re
import unicodedata

EARTH_RADIUS_KM = 6371.0
SERVICE_RADIUS_KM = 100.0

# Coordinates are intentionally kept as application data for this POC. A later
# production version can replace this registry with a maintained geocoding table.
CITY_COORDINATES: dict[str, tuple[float, float]] = {
    "barcelona": (41.3874, 2.1686),
    "calafell": (41.1998, 1.5683),
    "cambrils": (41.0697, 1.0597),
    "castellon de la plana": (39.9864, -0.0513),
    "girona": (41.9794, 2.8214),
    "lleida": (41.6176, 0.6200),
    "madrid": (40.4168, -3.7038),
    "reus": (41.1540, 1.1087),
    "salou": (41.0760, 1.1416),
    "tarragona": (41.1189, 1.2445),
    "torredembarra": (41.1451, 1.3970),
    "valencia": (39.4699, -0.3763),
    "el vendrell": (41.2157, 1.5343),
    "vila-seca": (41.1112, 1.1467),
    "vilanova i la geltru": (41.2239, 1.7251),
    "zaragoza": (41.6488, -0.8891),
}

POSTAL_PREFIX_COORDINATES: dict[str, tuple[float, float]] = {
    "08": CITY_COORDINATES["barcelona"],
    "12": CITY_COORDINATES["castellon de la plana"],
    "17": CITY_COORDINATES["girona"],
    "25": CITY_COORDINATES["lleida"],
    "43": CITY_COORDINATES["tarragona"],
    "46": CITY_COORDINATES["valencia"],
    "50": CITY_COORDINATES["zaragoza"],
}


def normalize_location(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value.lower().strip())
    return "".join(character for character in normalized if unicodedata.category(character) != "Mn")


def coordinates_for_location(value: str) -> tuple[float, float] | None:
    postal_code = re.search(r"\b(\d{5})\b", value)
    if postal_code:
        return POSTAL_PREFIX_COORDINATES.get(postal_code.group(1)[:2])
    normalized = normalize_location(value)
    if normalized in CITY_COORDINATES:
        return CITY_COORDINATES[normalized]
    matches = [coordinates for city, coordinates in CITY_COORDINATES.items() if city in normalized or normalized in city]
    return matches[0] if len(matches) == 1 else None


def distance_km(origin: tuple[float, float], destination: tuple[float, float]) -> float:
    origin_lat, origin_lon = map(radians, origin)
    destination_lat, destination_lon = map(radians, destination)
    delta_lat = destination_lat - origin_lat
    delta_lon = destination_lon - origin_lon
    value = sin(delta_lat / 2) ** 2 + cos(origin_lat) * cos(destination_lat) * sin(delta_lon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * asin(sqrt(value))


def check_service_coverage(origin_city: str | None, destination: str) -> dict[str, object]:
    origin = coordinates_for_location(origin_city or "")
    target = coordinates_for_location(destination)
    if not origin:
        return {"status": "unavailable", "reason": "origin_not_configured"}
    if not target:
        return {"status": "unavailable", "reason": "location_not_found"}
    distance = round(distance_km(origin, target), 1)
    return {
        "status": "within_radius" if distance <= SERVICE_RADIUS_KM else "outside_radius",
        "distance_km": distance,
        "radius_km": SERVICE_RADIUS_KM,
        "origin": origin_city,
        "destination": destination,
    }
