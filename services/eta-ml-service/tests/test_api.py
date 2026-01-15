"""
Tests for API Endpoints - Prediction, Health, and Metrics
"""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock, MagicMock
from datetime import datetime

from app.main import app


class TestHealthEndpoints:
    """Test health check endpoints"""

    @pytest.fixture
    def client(self):
        return TestClient(app)

    def test_health_endpoint(self, client):
        """Test basic health endpoint"""
        response = client.get("/health")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] in ["healthy", "degraded"]

    def test_health_ready_endpoint(self, client):
        """Test readiness probe"""
        response = client.get("/health/ready")
        
        # May be 200 or 503 depending on model state
        assert response.status_code in [200, 503]

    def test_health_live_endpoint(self, client):
        """Test liveness probe"""
        response = client.get("/health/live")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "alive"

    def test_health_response_format(self, client):
        """Test health response includes required fields"""
        response = client.get("/health")
        
        data = response.json()
        assert "status" in data
        assert "timestamp" in data
        assert "version" in data


class TestPredictionEndpoints:
    """Test ETA prediction endpoints"""

    @pytest.fixture
    def client(self):
        return TestClient(app)

    @pytest.fixture
    def valid_request(self):
        return {
            "origin": {"lat": 6.5244, "lng": 3.3792},
            "destination": {"lat": 6.4541, "lng": 3.3947},
            "vehicle_type": "car",
        }

    def test_predict_endpoint_valid_request(self, client, valid_request):
        """Test prediction with valid request"""
        with patch("app.routes.predictions.get_prediction_services") as mock_services:
            mock_model = MagicMock()
            mock_model.predict.return_value = {
                "eta_minutes": 15.0,
                "confidence_low": 12.0,
                "confidence_high": 18.0,
                "model_version": "test-v1",
            }
            mock_services.return_value = (
                mock_model,
                AsyncMock(),  # traffic
                AsyncMock(),  # weather
                AsyncMock(),  # features
                AsyncMock(),  # cache
            )
            
            response = client.post("/api/v1/eta/predict", json=valid_request)
        
        assert response.status_code == 200
        data = response.json()
        assert "eta_minutes" in data
        assert "confidence_low" in data
        assert "confidence_high" in data

    def test_predict_endpoint_missing_origin(self, client):
        """Test prediction fails without origin"""
        request = {
            "destination": {"lat": 6.4541, "lng": 3.3947},
            "vehicle_type": "car",
        }
        
        response = client.post("/api/v1/eta/predict", json=request)
        
        assert response.status_code == 422

    def test_predict_endpoint_missing_destination(self, client):
        """Test prediction fails without destination"""
        request = {
            "origin": {"lat": 6.5244, "lng": 3.3792},
            "vehicle_type": "car",
        }
        
        response = client.post("/api/v1/eta/predict", json=request)
        
        assert response.status_code == 422

    def test_predict_endpoint_invalid_coordinates(self, client):
        """Test prediction fails with invalid coordinates"""
        request = {
            "origin": {"lat": 200, "lng": 3.3792},  # Invalid lat
            "destination": {"lat": 6.4541, "lng": 3.3947},
            "vehicle_type": "car",
        }
        
        response = client.post("/api/v1/eta/predict", json=request)
        
        assert response.status_code == 422

    def test_predict_endpoint_with_departure_time(self, client, valid_request):
        """Test prediction with future departure time"""
        valid_request["departure_time"] = "2026-01-14T15:00:00Z"
        
        with patch("app.routes.predictions.get_prediction_services") as mock_services:
            mock_model = MagicMock()
            mock_model.predict.return_value = {
                "eta_minutes": 15.0,
                "confidence_low": 12.0,
                "confidence_high": 18.0,
                "model_version": "test-v1",
            }
            mock_services.return_value = (
                mock_model,
                AsyncMock(),
                AsyncMock(),
                AsyncMock(),
                AsyncMock(),
            )
            
            response = client.post("/api/v1/eta/predict", json=valid_request)
        
        assert response.status_code == 200

    def test_predict_endpoint_different_vehicle_types(self, client):
        """Test prediction for different vehicle types"""
        vehicle_types = ["car", "motorcycle", "bicycle"]
        
        for vehicle_type in vehicle_types:
            request = {
                "origin": {"lat": 6.5244, "lng": 3.3792},
                "destination": {"lat": 6.4541, "lng": 3.3947},
                "vehicle_type": vehicle_type,
            }
            
            with patch("app.routes.predictions.get_prediction_services") as mock_services:
                mock_model = MagicMock()
                mock_model.predict.return_value = {
                    "eta_minutes": 15.0,
                    "confidence_low": 12.0,
                    "confidence_high": 18.0,
                    "model_version": "test-v1",
                }
                mock_services.return_value = (
                    mock_model,
                    AsyncMock(),
                    AsyncMock(),
                    AsyncMock(),
                    AsyncMock(),
                )
                
                response = client.post("/api/v1/eta/predict", json=request)
            
            assert response.status_code == 200


class TestMetricsEndpoint:
    """Test Prometheus metrics endpoint"""

    @pytest.fixture
    def client(self):
        return TestClient(app)

    def test_metrics_endpoint(self, client):
        """Test metrics endpoint returns prometheus format"""
        response = client.get("/metrics")
        
        assert response.status_code == 200
        assert "text/plain" in response.headers.get("content-type", "")

    def test_metrics_contain_request_counter(self, client):
        """Test metrics include request counter"""
        response = client.get("/metrics")
        
        content = response.text
        # Should contain prediction request metrics
        assert "eta_prediction" in content.lower() or "http_requests" in content.lower()


class TestErrorHandling:
    """Test API error handling"""

    @pytest.fixture
    def client(self):
        return TestClient(app)

    def test_404_not_found(self, client):
        """Test 404 for unknown endpoint"""
        response = client.get("/api/v1/unknown")
        
        assert response.status_code == 404

    def test_method_not_allowed(self, client):
        """Test 405 for wrong HTTP method"""
        response = client.get("/api/v1/eta/predict")  # Should be POST
        
        assert response.status_code == 405

    def test_invalid_json(self, client):
        """Test error on invalid JSON"""
        response = client.post(
            "/api/v1/eta/predict",
            content="not valid json",
            headers={"Content-Type": "application/json"},
        )
        
        assert response.status_code == 422


class TestCaching:
    """Test prediction caching behavior"""

    @pytest.fixture
    def client(self):
        return TestClient(app)

    def test_cache_hit_returns_cached(self):
        """Test cache hit returns cached prediction"""
        # This would require integration testing with Redis
        pass

    def test_cache_miss_computes_prediction(self):
        """Test cache miss computes new prediction"""
        # This would require integration testing with Redis
        pass
