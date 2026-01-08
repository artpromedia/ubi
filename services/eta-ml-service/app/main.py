"""
ML-Powered ETA Prediction Service

High-accuracy ETA predictions using XGBoost with features:
- Distance and route characteristics
- Historical trip data patterns
- Real-time traffic conditions
- Time-of-day and day-of-week patterns
- Weather impact
- Driver performance metrics
- Special events
"""

from contextlib import asynccontextmanager
from datetime import datetime
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import make_asgi_app
import structlog

from app.config import settings
from app.routes import predictions_router, health_router, experiments_router, training_router
from app.routes import predictions as predictions_module
from app.routes import health as health_module
from app.routes import experiments as experiments_module
from app.routes import training as training_module
from app.services.model_service import ModelService
from app.services.traffic_service import TrafficService
from app.services.weather_service import WeatherService
from app.services.feature_service import FeatureService
from app.services.cache_service import CacheService
from app.metrics import setup_metrics, update_model_metrics

# Setup structured logging
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan management"""
    logger.info("Starting ETA ML Service", version=settings.version)
    
    # Initialize services
    cache_service = await CacheService.create(settings.redis_url)
    model_service = ModelService(settings.model_path)
    traffic_service = TrafficService(
        settings.traffic_api_key,
        cache_service,
    )
    weather_service = WeatherService(
        settings.weather_api_key,
        cache_service,
    )
    feature_service = FeatureService(
        traffic_service,
        weather_service,
    )
    
    # Store in app state
    app.state.cache = cache_service
    app.state.model_service = model_service
    app.state.traffic_service = traffic_service
    app.state.weather_service = weather_service
    app.state.feature_service = feature_service
    
    # Load ML model
    try:
        await model_service.load_model()
        logger.info("ML model loaded successfully")
        update_model_metrics(model_service.get_model_version(), True)
    except Exception as e:
        logger.warning("ML model not available, using fallback", error=str(e))
        update_model_metrics("none", False)
    
    # Inject dependencies into route modules
    predictions_module.deps.feature_service = feature_service
    predictions_module.deps.model_service = model_service
    predictions_module.deps.traffic_service = traffic_service
    predictions_module.deps.weather_service = weather_service
    predictions_module.deps.cache_service = cache_service
    predictions_module.deps.settings = settings
    
    health_module.deps.model_service = model_service
    health_module.deps.cache_service = cache_service
    health_module.deps.start_time = datetime.utcnow()
    
    experiments_module.deps.cache_service = cache_service
    
    training_module.deps.cache_service = cache_service
    training_module.deps.model_service = model_service
    training_module.deps.settings = settings
    
    yield
    
    # Cleanup
    logger.info("Shutting down ETA ML Service")
    await cache_service.close()


# Create FastAPI app
app = FastAPI(
    title="ETA ML Service",
    description="Machine Learning powered ETA prediction service",
    version=settings.version,
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Setup Prometheus metrics
setup_metrics()

# Mount Prometheus metrics endpoint
metrics_app = make_asgi_app()
app.mount("/metrics", metrics_app)

# Include routers
app.include_router(health_router, tags=["Health"])
app.include_router(predictions_router, prefix="/api/v1", tags=["Predictions"])
app.include_router(experiments_router, prefix="/api/v1", tags=["A/B Testing"])
app.include_router(training_router, prefix="/api/v1", tags=["Training"])


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "service": "eta-ml-service",
        "version": settings.version,
        "status": "running",
    }
