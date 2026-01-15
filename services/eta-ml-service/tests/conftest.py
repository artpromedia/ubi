"""
Pytest fixtures for ETA ML Service tests
"""

import pytest
from unittest.mock import AsyncMock, MagicMock
import numpy as np

# Import with try/except for when running tests without full dependencies
try:
    from fastapi.testclient import TestClient
    from app.main import app
    HAS_FASTAPI = True
except ImportError:
    HAS_FASTAPI = False

try:
    from app.models.schemas import LatLng, ETAPredictionRequest
    from app.services.cache_service import CacheService
    from app.services.model_service import ModelService
    from app.services.feature_service import FeatureService
    from app.services.traffic_service import TrafficService
    from app.services.weather_service import WeatherService
    HAS_APP = True
except ImportError:
    HAS_APP = False


@pytest.fixture
def test_client():
    """FastAPI test client"""
    if not HAS_FASTAPI:
        pytest.skip("FastAPI not installed")
    return TestClient(app)


@pytest.fixture
def mock_cache():
    """Mock cache service"""
    cache = AsyncMock()
    cache.get = AsyncMock(return_value=None)
    cache.set = AsyncMock(return_value=True)
    cache.delete = AsyncMock(return_value=True)
    return cache


@pytest.fixture
def mock_model():
    """Mock XGBoost model"""
    model = MagicMock()
    model.predict.return_value = np.array([15.0])  # 15 minutes
    return model


@pytest.fixture
def mock_model_service(mock_model):
    """Mock model service"""
    service = MagicMock()
    service.model = mock_model
    service.is_loaded = True
    service.predict = AsyncMock(return_value=(900.0, 720.0, 1080.0))  # 15 min ± 3
    return service


@pytest.fixture
def mock_traffic_service(mock_cache):
    """Mock traffic service"""
    service = AsyncMock()
    service.get_traffic_conditions = AsyncMock(return_value={
        "congestion_level": "moderate",
        "speed_ratio": 0.8,
        "incidents": 0,
        "delay_minutes": 2,
    })
    service.get_traffic_flow = AsyncMock(return_value={
        "speed_ratio": 0.85,
        "level": "moderate",
    })
    return service


@pytest.fixture
def mock_weather_service(mock_cache):
    """Mock weather service"""
    service = AsyncMock()
    service.get_current_weather = AsyncMock(return_value={
        "condition": "clear",
        "description": "clear sky",
        "temperature": 25,
        "humidity": 50,
        "precipitation": 0,
        "visibility": 10,
        "wind_speed": 5,
    })
    service.get_weather_impact_multiplier = MagicMock(return_value=1.0)
    return service


@pytest.fixture
def sample_origin():
    """Sample origin location (Lagos, Nigeria)"""
    if not HAS_APP:
        pytest.skip("App modules not available")
    return LatLng(lat=6.5244, lng=3.3792)


@pytest.fixture
def sample_destination():
    """Sample destination location (Lagos Island)"""
    if not HAS_APP:
        pytest.skip("App modules not available")
    return LatLng(lat=6.4541, lng=3.3947)


@pytest.fixture
def sample_prediction_request(sample_origin, sample_destination):
    """Sample ETA prediction request"""
    if not HAS_APP:
        pytest.skip("App modules not available")
    return ETAPredictionRequest(
        origin=sample_origin,
        destination=sample_destination,
        vehicle_type="car",
        departure_time=None,  # Use current time
    )


@pytest.fixture
def sample_features():
    """Sample feature dictionary for model prediction"""
    return {
        "straight_distance_km": 8.5,
        "estimated_road_distance_km": 11.05,
        "bearing": 45.0,
        "bearing_sin": 0.707,
        "bearing_cos": 0.707,
        "hour": 14,
        "hour_sin": 0.0,
        "hour_cos": -1.0,
        "day_of_week": 2,
        "day_sin": 0.78,
        "day_cos": -0.62,
        "is_weekend": 0,
        "is_rush_hour_morning": 0,
        "is_rush_hour_evening": 0,
        "is_night": 0,
        "is_holiday": 0,
        "month": 1,
        "traffic_speed_ratio": 0.8,
        "traffic_delay_minutes": 2,
        "traffic_level_encoded": 1,
        "traffic_incidents_count": 0,
        "traffic_congestion_percent": 0.3,
        "weather_condition_encoded": 0,
        "is_raining": 0,
        "precipitation_mm": 0,
        "visibility_km": 10,
    }


@pytest.fixture
def sample_feature_vector():
    """Sample numerical feature vector for XGBoost"""
    return np.array([
        8.5,   # straight_distance_km
        11.05, # estimated_road_distance_km
        0.707, # bearing_sin
        0.707, # bearing_cos
        14,    # hour
        0.0,   # hour_sin
        -1.0,  # hour_cos
        2,     # day_of_week
        0.78,  # day_sin
        -0.62, # day_cos
        0,     # is_weekend
        0,     # is_rush_hour_morning
        0,     # is_rush_hour_evening
        0,     # is_night
        0,     # is_holiday
        0.8,   # traffic_speed_ratio
        2,     # traffic_delay_minutes
        1,     # traffic_level_encoded
        0,     # traffic_incidents_count
        0.3,   # traffic_congestion_percent
        0,     # weather_condition_encoded
        0,     # is_raining
        0,     # precipitation_mm
        10,    # visibility_km
    ]).reshape(1, -1)
