"""
Tests for Model Service - XGBoost ETA predictions
"""

import pytest
import numpy as np
from unittest.mock import MagicMock, patch, AsyncMock
from pathlib import Path

from app.services.model_service import ModelService
from app.models.schemas import LatLng


class TestModelService:
    """Test suite for ModelService"""

    def test_model_service_initialization(self):
        """Test model service initializes correctly"""
        service = ModelService()
        assert service.model is None
        assert service.is_loaded is False
        assert service.model_version is not None

    def test_fallback_prediction_short_distance(self):
        """Test fallback heuristic for short distances"""
        service = ModelService()
        
        features = {
            "distance_km": 2.0,
            "traffic_speed_ratio": 1.0,
            "is_rush_hour": 0,
        }
        
        result = service._fallback_prediction(features)
        
        assert "eta_minutes" in result
        assert "confidence_low" in result
        assert "confidence_high" in result
        assert result["eta_minutes"] > 0
        assert result["confidence_low"] < result["eta_minutes"]
        assert result["confidence_high"] > result["eta_minutes"]

    def test_fallback_prediction_rush_hour(self):
        """Test fallback applies rush hour multiplier"""
        service = ModelService()
        
        features_normal = {
            "distance_km": 5.0,
            "traffic_speed_ratio": 1.0,
            "is_rush_hour": 0,
        }
        
        features_rush = {
            "distance_km": 5.0,
            "traffic_speed_ratio": 1.0,
            "is_rush_hour": 1,
        }
        
        result_normal = service._fallback_prediction(features_normal)
        result_rush = service._fallback_prediction(features_rush)
        
        # Rush hour should have higher ETA
        assert result_rush["eta_minutes"] > result_normal["eta_minutes"]

    def test_fallback_prediction_traffic_congestion(self):
        """Test fallback adjusts for traffic congestion"""
        service = ModelService()
        
        features_clear = {
            "distance_km": 5.0,
            "traffic_speed_ratio": 1.0,
            "is_rush_hour": 0,
        }
        
        features_congested = {
            "distance_km": 5.0,
            "traffic_speed_ratio": 0.5,
            "is_rush_hour": 0,
        }
        
        result_clear = service._fallback_prediction(features_clear)
        result_congested = service._fallback_prediction(features_congested)
        
        # Congested traffic should have higher ETA
        assert result_congested["eta_minutes"] > result_clear["eta_minutes"]

    def test_fallback_prediction_long_distance(self):
        """Test fallback for long distances"""
        service = ModelService()
        
        features = {
            "distance_km": 50.0,
            "traffic_speed_ratio": 0.9,
            "is_rush_hour": 0,
        }
        
        result = service._fallback_prediction(features)
        
        # Long distance should have reasonable ETA
        assert result["eta_minutes"] > 30
        assert result["eta_minutes"] < 120

    @patch("app.services.model_service.xgb")
    def test_model_loading(self, mock_xgb):
        """Test model loading from file"""
        mock_booster = MagicMock()
        mock_xgb.Booster.return_value = mock_booster
        
        service = ModelService()
        
        with patch.object(Path, "exists", return_value=True):
            service.load_model("/path/to/model.json")
        
        assert service.is_loaded is True
        assert service.model is not None

    def test_model_loading_file_not_found(self):
        """Test graceful handling when model file not found"""
        service = ModelService()
        
        # Should not raise, just log warning
        service.load_model("/nonexistent/path/model.json")
        
        assert service.is_loaded is False

    def test_predict_without_model_uses_fallback(self):
        """Test prediction falls back to heuristics when model not loaded"""
        service = ModelService()
        
        features = {
            "distance_km": 10.0,
            "traffic_speed_ratio": 0.8,
            "is_rush_hour": 1,
        }
        
        result = service.predict(features)
        
        assert "eta_minutes" in result
        assert "model_version" in result
        assert "fallback" in result["model_version"].lower()

    @patch("app.services.model_service.xgb")
    def test_predict_with_model(self, mock_xgb):
        """Test prediction with loaded model"""
        mock_booster = MagicMock()
        mock_booster.predict.return_value = np.array([15.5])
        mock_xgb.Booster.return_value = mock_booster
        mock_xgb.DMatrix.return_value = MagicMock()
        
        service = ModelService()
        service.model = mock_booster
        service.is_loaded = True
        
        features = {
            "distance_km": 10.0,
            "hour_of_day": 14,
            "day_of_week": 2,
            "is_weekend": 0,
            "is_rush_hour": 0,
            "traffic_speed_ratio": 0.8,
            "weather_condition_code": 0,
        }
        
        result = service.predict(features)
        
        assert result["eta_minutes"] == pytest.approx(15.5, rel=0.1)

    def test_confidence_interval_calculation(self):
        """Test confidence interval calculation"""
        service = ModelService()
        
        eta = 20.0
        low, high = service._calculate_confidence_interval(eta, uncertainty=0.15)
        
        assert low < eta
        assert high > eta
        assert low == pytest.approx(17.0, rel=0.1)
        assert high == pytest.approx(23.0, rel=0.1)

    def test_minimum_eta_enforcement(self):
        """Test minimum ETA is enforced"""
        service = ModelService()
        
        features = {
            "distance_km": 0.1,  # Very short distance
            "traffic_speed_ratio": 1.0,
            "is_rush_hour": 0,
        }
        
        result = service._fallback_prediction(features)
        
        # Should have minimum ETA of at least 1-2 minutes
        assert result["eta_minutes"] >= 1.0


class TestModelServiceAsync:
    """Async tests for ModelService"""

    @pytest.mark.asyncio
    async def test_async_predict(self):
        """Test async prediction wrapper"""
        service = ModelService()
        
        features = {
            "distance_km": 8.0,
            "traffic_speed_ratio": 0.9,
            "is_rush_hour": 0,
        }
        
        result = await service.predict_async(features)
        
        assert "eta_minutes" in result
        assert result["eta_minutes"] > 0
