"""
Configuration settings for ETA ML Service
"""

from typing import List
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from environment"""
    
    # Service info
    version: str = "1.0.0"
    environment: str = "development"
    debug: bool = False
    
    # Server
    host: str = "0.0.0.0"
    port: int = 4020
    
    # Database
    database_url: str = "postgresql+asyncpg://ubi:ubi@localhost:5432/ubi_eta"
    
    # Redis
    redis_url: str = "redis://localhost:6379/0"
    
    # ML Model
    model_path: str = "./models/eta_model.joblib"
    model_version: str = "v1.0"
    fallback_enabled: bool = True
    
    # External APIs
    traffic_api_key: str = ""
    traffic_api_url: str = "https://api.tomtom.com/traffic"
    weather_api_key: str = ""
    weather_api_url: str = "https://api.openweathermap.org/data/2.5"
    
    # Feature flags
    enable_auto_retrain: bool = True
    retrain_interval_hours: int = 24
    enable_ab_testing: bool = True
    ml_traffic_percentage: int = 100  # % of requests using ML model
    
    # Performance
    prediction_timeout_ms: int = 50  # Target p99 < 50ms
    cache_ttl_seconds: int = 300  # 5 minutes
    traffic_update_interval_seconds: int = 30
    
    # Accuracy targets
    target_accuracy_3min: float = 0.80  # 80% within ±3 minutes
    target_improvement_vs_simple: float = 0.20  # 20% improvement
    
    # CORS
    cors_origins: List[str] = ["*"]
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    """Cached settings instance"""
    return Settings()


settings = get_settings()
