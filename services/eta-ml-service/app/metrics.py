"""
Prometheus Metrics for ETA ML Service
"""

from prometheus_client import Counter, Histogram, Gauge, Info

# Prediction metrics
PREDICTION_COUNT = Counter(
    "eta_predictions_total",
    "Total number of ETA predictions",
    ["method", "status"],
)

PREDICTION_LATENCY = Histogram(
    "eta_prediction_latency_seconds",
    "ETA prediction latency in seconds",
    buckets=[0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 1.0],
)

PREDICTION_ERRORS = Counter(
    "eta_prediction_errors_total",
    "Total number of prediction errors",
    ["error_type"],
)

# Feature generation metrics
FEATURE_GENERATION_LATENCY = Histogram(
    "eta_feature_generation_latency_seconds",
    "Feature generation latency in seconds",
    buckets=[0.001, 0.005, 0.01, 0.025, 0.05, 0.1],
)

# Model metrics
MODEL_LOADED = Gauge(
    "eta_model_loaded",
    "Whether the ML model is loaded (1) or not (0)",
)

MODEL_VERSION = Info(
    "eta_model_version",
    "Current model version information",
)

# External service metrics
TRAFFIC_API_LATENCY = Histogram(
    "eta_traffic_api_latency_seconds",
    "Traffic API request latency",
    buckets=[0.05, 0.1, 0.25, 0.5, 1.0, 2.0],
)

TRAFFIC_API_ERRORS = Counter(
    "eta_traffic_api_errors_total",
    "Traffic API errors",
    ["error_type"],
)

WEATHER_API_LATENCY = Histogram(
    "eta_weather_api_latency_seconds",
    "Weather API request latency",
    buckets=[0.05, 0.1, 0.25, 0.5, 1.0, 2.0],
)

WEATHER_API_ERRORS = Counter(
    "eta_weather_api_errors_total",
    "Weather API errors",
    ["error_type"],
)

# Cache metrics
CACHE_HITS = Counter(
    "eta_cache_hits_total",
    "Cache hits",
    ["cache_type"],
)

CACHE_MISSES = Counter(
    "eta_cache_misses_total",
    "Cache misses",
    ["cache_type"],
)

# Accuracy metrics
ACCURACY_WITHIN_3MIN = Gauge(
    "eta_accuracy_within_3min_percent",
    "Percentage of predictions within 3 minutes of actual",
)

ACCURACY_WITHIN_5MIN = Gauge(
    "eta_accuracy_within_5min_percent",
    "Percentage of predictions within 5 minutes of actual",
)

MEAN_ABSOLUTE_ERROR = Gauge(
    "eta_mean_absolute_error_minutes",
    "Mean absolute error in minutes",
)

# Training metrics
TRAINING_IN_PROGRESS = Gauge(
    "eta_training_in_progress",
    "Whether training is currently in progress",
)

TRAINING_SAMPLES = Gauge(
    "eta_training_samples_total",
    "Number of samples used in last training",
)

LAST_TRAINING_TIMESTAMP = Gauge(
    "eta_last_training_timestamp",
    "Timestamp of last model training",
)

# Experiment metrics
ACTIVE_EXPERIMENTS = Gauge(
    "eta_active_experiments",
    "Number of active A/B experiments",
)

EXPERIMENT_TRAFFIC = Gauge(
    "eta_experiment_traffic_percent",
    "Percentage of traffic in experimental group",
    ["experiment_id"],
)


def setup_metrics():
    """Initialize metrics with default values"""
    
    MODEL_LOADED.set(0)
    ACCURACY_WITHIN_3MIN.set(0)
    ACCURACY_WITHIN_5MIN.set(0)
    MEAN_ABSOLUTE_ERROR.set(0)
    TRAINING_IN_PROGRESS.set(0)
    TRAINING_SAMPLES.set(0)
    ACTIVE_EXPERIMENTS.set(0)


def update_model_metrics(version: str, is_loaded: bool):
    """Update model-related metrics"""
    
    MODEL_LOADED.set(1 if is_loaded else 0)
    if is_loaded:
        MODEL_VERSION.info({"version": version})


def update_accuracy_metrics(within_3min: float, within_5min: float, mae: float):
    """Update accuracy metrics"""
    
    ACCURACY_WITHIN_3MIN.set(within_3min)
    ACCURACY_WITHIN_5MIN.set(within_5min)
    MEAN_ABSOLUTE_ERROR.set(mae)


def update_training_metrics(is_training: bool, samples: int = 0, timestamp: float = 0):
    """Update training metrics"""
    
    TRAINING_IN_PROGRESS.set(1 if is_training else 0)
    if samples > 0:
        TRAINING_SAMPLES.set(samples)
    if timestamp > 0:
        LAST_TRAINING_TIMESTAMP.set(timestamp)
