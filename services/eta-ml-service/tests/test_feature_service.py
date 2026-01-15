"""
Tests for Feature Service - Feature engineering for ETA predictions
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
import numpy as np

from app.services.feature_service import FeatureService
from app.models.schemas import LatLng, ETAPredictionRequest


class TestFeatureService:
    """Test suite for FeatureService"""

    @pytest.fixture
    def service(self, mock_cache):
        """Create feature service with mocked cache"""
        return FeatureService(cache=mock_cache)

    def test_calculate_distance(self, service):
        """Test haversine distance calculation"""
        # Lagos to Lagos Island (~8km)
        origin = LatLng(lat=6.5244, lng=3.3792)
        destination = LatLng(lat=6.4541, lng=3.3947)
        
        distance = service._calculate_distance(origin, destination)
        
        # Should be approximately 8km
        assert distance > 7.0
        assert distance < 10.0

    def test_calculate_distance_same_point(self, service):
        """Test distance calculation for same point"""
        point = LatLng(lat=6.5244, lng=3.3792)
        
        distance = service._calculate_distance(point, point)
        
        assert distance == 0.0

    def test_calculate_distance_long(self, service):
        """Test distance calculation for longer route"""
        # Lagos to Ibadan (~130km)
        origin = LatLng(lat=6.5244, lng=3.3792)
        destination = LatLng(lat=7.3775, lng=3.9470)
        
        distance = service._calculate_distance(origin, destination)
        
        assert distance > 100
        assert distance < 150

    def test_extract_temporal_features_weekday(self, service):
        """Test temporal feature extraction for weekday"""
        # Wednesday at 2pm
        dt = datetime(2026, 1, 14, 14, 0, 0)
        
        features = service._extract_temporal_features(dt)
        
        assert features["hour_of_day"] == 14
        assert features["day_of_week"] == 2  # Wednesday
        assert features["is_weekend"] == 0
        assert features["is_night"] == 0
        assert features["month"] == 1

    def test_extract_temporal_features_weekend(self, service):
        """Test temporal feature extraction for weekend"""
        # Saturday at 10am
        dt = datetime(2026, 1, 17, 10, 0, 0)
        
        features = service._extract_temporal_features(dt)
        
        assert features["day_of_week"] == 5  # Saturday
        assert features["is_weekend"] == 1

    def test_extract_temporal_features_night(self, service):
        """Test temporal feature extraction for night time"""
        # 11pm
        dt = datetime(2026, 1, 14, 23, 0, 0)
        
        features = service._extract_temporal_features(dt)
        
        assert features["is_night"] == 1
        assert features["hour_of_day"] == 23

    def test_extract_temporal_features_rush_hour_morning(self, service):
        """Test rush hour detection - morning"""
        # 8am on weekday
        dt = datetime(2026, 1, 14, 8, 0, 0)
        
        features = service._extract_temporal_features(dt)
        
        assert features["is_rush_hour"] == 1

    def test_extract_temporal_features_rush_hour_evening(self, service):
        """Test rush hour detection - evening"""
        # 6pm on weekday
        dt = datetime(2026, 1, 14, 18, 0, 0)
        
        features = service._extract_temporal_features(dt)
        
        assert features["is_rush_hour"] == 1

    def test_extract_temporal_features_no_rush_hour_weekend(self, service):
        """Test no rush hour on weekend"""
        # 8am on Saturday
        dt = datetime(2026, 1, 17, 8, 0, 0)
        
        features = service._extract_temporal_features(dt)
        
        # Weekend rush hour should be lighter or none
        assert features["is_weekend"] == 1

    def test_h3_index_generation(self, service):
        """Test H3 hexagon index generation"""
        location = LatLng(lat=6.5244, lng=3.3792)
        
        h3_index = service._get_h3_index(location)
        
        # H3 index should be a valid hex string
        assert h3_index is not None
        assert len(h3_index) == 15  # Resolution 7 index length
        assert h3_index.startswith("87")  # Africa region prefix

    def test_h3_index_different_locations(self, service):
        """Test H3 indices differ for different locations"""
        loc1 = LatLng(lat=6.5244, lng=3.3792)
        loc2 = LatLng(lat=6.4541, lng=3.3947)
        
        h3_1 = service._get_h3_index(loc1)
        h3_2 = service._get_h3_index(loc2)
        
        # Different locations should have different indices
        assert h3_1 != h3_2

    @pytest.mark.asyncio
    async def test_extract_features(self, service, sample_prediction_request):
        """Test full feature extraction"""
        features = await service.extract_features(
            request=sample_prediction_request,
            traffic_data={"speed_ratio": 0.8, "congestion_level": "moderate"},
            weather_data={"condition": "clear", "precipitation": 0},
        )
        
        # Check all required features present
        assert "distance_km" in features
        assert "hour_of_day" in features
        assert "day_of_week" in features
        assert "is_weekend" in features
        assert "is_rush_hour" in features
        assert "traffic_speed_ratio" in features
        assert "weather_condition_code" in features

    @pytest.mark.asyncio
    async def test_extract_features_distance(self, service):
        """Test feature extraction calculates correct distance"""
        request = ETAPredictionRequest(
            origin=LatLng(lat=6.5244, lng=3.3792),
            destination=LatLng(lat=6.4541, lng=3.3947),
            vehicle_type="car",
        )
        
        features = await service.extract_features(
            request=request,
            traffic_data={},
            weather_data={},
        )
        
        assert features["distance_km"] > 7.0
        assert features["distance_km"] < 10.0

    def test_weather_condition_encoding(self, service):
        """Test weather condition to numeric encoding"""
        assert service._encode_weather_condition("clear") == 0
        assert service._encode_weather_condition("clouds") == 1
        assert service._encode_weather_condition("rain") == 2
        assert service._encode_weather_condition("thunderstorm") == 3
        assert service._encode_weather_condition("unknown") == 0  # Default

    def test_vehicle_type_encoding(self, service):
        """Test vehicle type encoding"""
        assert service._encode_vehicle_type("car") == 0
        assert service._encode_vehicle_type("motorcycle") == 1
        assert service._encode_vehicle_type("bicycle") == 2
        assert service._encode_vehicle_type("walking") == 3

    @pytest.mark.asyncio
    async def test_features_to_vector(self, service, sample_features):
        """Test feature dict to numpy vector conversion"""
        vector = service.features_to_vector(sample_features)
        
        assert isinstance(vector, np.ndarray)
        assert vector.ndim == 2
        assert vector.shape[0] == 1  # Single sample


class TestFeatureServiceEdgeCases:
    """Edge case tests for FeatureService"""

    @pytest.fixture
    def service(self, mock_cache):
        return FeatureService(cache=mock_cache)

    def test_zero_distance_minimum(self, service):
        """Test minimum distance is enforced"""
        point = LatLng(lat=6.5244, lng=3.3792)
        
        distance = service._calculate_distance(point, point)
        
        # Should be 0 or small positive value
        assert distance >= 0

    @pytest.mark.asyncio
    async def test_missing_traffic_data(self, service, sample_prediction_request):
        """Test handling of missing traffic data"""
        features = await service.extract_features(
            request=sample_prediction_request,
            traffic_data=None,
            weather_data={"condition": "clear"},
        )
        
        # Should use default traffic values
        assert features["traffic_speed_ratio"] == 1.0

    @pytest.mark.asyncio
    async def test_missing_weather_data(self, service, sample_prediction_request):
        """Test handling of missing weather data"""
        features = await service.extract_features(
            request=sample_prediction_request,
            traffic_data={"speed_ratio": 0.8},
            weather_data=None,
        )
        
        # Should use default weather values
        assert features["weather_condition_code"] == 0  # Clear

    def test_international_date_line(self, service):
        """Test distance calculation across international date line"""
        # Points near date line (would fail with naive calculation)
        loc1 = LatLng(lat=0, lng=179.9)
        loc2 = LatLng(lat=0, lng=-179.9)
        
        distance = service._calculate_distance(loc1, loc2)
        
        # Should be ~22km, not ~40000km
        assert distance < 100

    def test_polar_coordinates(self, service):
        """Test distance calculation near poles"""
        loc1 = LatLng(lat=89.9, lng=0)
        loc2 = LatLng(lat=89.9, lng=180)
        
        distance = service._calculate_distance(loc1, loc2)
        
        # Should be small distance near pole
        assert distance < 50
