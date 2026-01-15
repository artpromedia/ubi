"""
ETA Model Training Script

This script trains an XGBoost model for ETA prediction using historical ride data.

Usage:
    python -m app.training.train_model [options]

Options:
    --data-path PATH      Path to training data CSV
    --output-path PATH    Path to save trained model
    --test-size FLOAT     Test set proportion (default: 0.2)
    --tune               Enable hyperparameter tuning
"""

import argparse
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Tuple, Optional

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Feature columns used by the model
FEATURE_COLUMNS = [
    "distance_km",
    "hour_of_day",
    "day_of_week",
    "is_weekend",
    "is_rush_hour",
    "is_night",
    "month",
    "traffic_speed_ratio",
    "traffic_congestion",
    "weather_condition_code",
    "precipitation",
    "visibility_km",
    "vehicle_type_code",
    "origin_zone_type_code",
    "destination_zone_type_code",
]

TARGET_COLUMN = "actual_eta_minutes"


def load_training_data(data_path: str) -> pd.DataFrame:
    """Load and validate training data from CSV"""
    
    logger.info(f"Loading training data from {data_path}")
    
    df = pd.read_csv(data_path)
    
    # Validate required columns
    missing_cols = set(FEATURE_COLUMNS + [TARGET_COLUMN]) - set(df.columns)
    if missing_cols:
        raise ValueError(f"Missing columns in training data: {missing_cols}")
    
    # Remove rows with missing values
    initial_rows = len(df)
    df = df.dropna(subset=FEATURE_COLUMNS + [TARGET_COLUMN])
    logger.info(f"Removed {initial_rows - len(df)} rows with missing values")
    
    # Remove outliers (ETA > 180 minutes or < 1 minute)
    df = df[(df[TARGET_COLUMN] >= 1) & (df[TARGET_COLUMN] <= 180)]
    logger.info(f"Training data loaded: {len(df)} samples")
    
    return df


def prepare_features(df: pd.DataFrame) -> Tuple[np.ndarray, np.ndarray]:
    """Prepare feature matrix and target vector"""
    
    X = df[FEATURE_COLUMNS].values
    y = df[TARGET_COLUMN].values
    
    logger.info(f"Feature matrix shape: {X.shape}")
    logger.info(f"Target vector shape: {y.shape}")
    
    return X, y


def get_default_params() -> Dict[str, Any]:
    """Get default XGBoost parameters"""
    
    return {
        "objective": "reg:squarederror",
        "eval_metric": "mae",
        "max_depth": 8,
        "learning_rate": 0.1,
        "n_estimators": 200,
        "min_child_weight": 5,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "gamma": 0.1,
        "reg_alpha": 0.1,
        "reg_lambda": 1.0,
        "random_state": 42,
        "n_jobs": -1,
    }


def tune_hyperparameters(
    X_train: np.ndarray,
    y_train: np.ndarray,
) -> Dict[str, Any]:
    """Tune hyperparameters using grid search"""
    
    from sklearn.model_selection import GridSearchCV
    
    logger.info("Starting hyperparameter tuning...")
    
    param_grid = {
        "max_depth": [6, 8, 10],
        "learning_rate": [0.05, 0.1, 0.15],
        "n_estimators": [100, 200, 300],
        "min_child_weight": [3, 5, 7],
        "subsample": [0.7, 0.8, 0.9],
    }
    
    base_params = get_default_params()
    model = xgb.XGBRegressor(**base_params)
    
    grid_search = GridSearchCV(
        model,
        param_grid,
        cv=3,
        scoring="neg_mean_absolute_error",
        n_jobs=-1,
        verbose=1,
    )
    
    grid_search.fit(X_train, y_train)
    
    logger.info(f"Best parameters: {grid_search.best_params_}")
    logger.info(f"Best MAE: {-grid_search.best_score_:.2f} minutes")
    
    return grid_search.best_params_


def train_model(
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_val: np.ndarray,
    y_val: np.ndarray,
    params: Optional[Dict[str, Any]] = None,
) -> xgb.XGBRegressor:
    """Train XGBoost model with early stopping"""
    
    if params is None:
        params = get_default_params()
    
    logger.info("Training XGBoost model...")
    logger.info(f"Parameters: {params}")
    
    model = xgb.XGBRegressor(**params)
    
    model.fit(
        X_train,
        y_train,
        eval_set=[(X_val, y_val)],
        verbose=True,
    )
    
    logger.info(f"Training complete. Best iteration: {model.best_iteration}")
    
    return model


def evaluate_model(
    model: xgb.XGBRegressor,
    X_test: np.ndarray,
    y_test: np.ndarray,
) -> Dict[str, float]:
    """Evaluate model performance"""
    
    y_pred = model.predict(X_test)
    
    metrics = {
        "mae": mean_absolute_error(y_test, y_pred),
        "rmse": np.sqrt(mean_squared_error(y_test, y_pred)),
        "r2": r2_score(y_test, y_pred),
        "mape": np.mean(np.abs((y_test - y_pred) / y_test)) * 100,
    }
    
    logger.info("Model Evaluation:")
    logger.info(f"  MAE:  {metrics['mae']:.2f} minutes")
    logger.info(f"  RMSE: {metrics['rmse']:.2f} minutes")
    logger.info(f"  R²:   {metrics['r2']:.4f}")
    logger.info(f"  MAPE: {metrics['mape']:.2f}%")
    
    return metrics


def analyze_feature_importance(
    model: xgb.XGBRegressor,
    feature_names: list,
) -> Dict[str, float]:
    """Analyze and log feature importance"""
    
    importance = dict(zip(feature_names, model.feature_importances_))
    importance = dict(sorted(importance.items(), key=lambda x: x[1], reverse=True))
    
    logger.info("\nFeature Importance:")
    for feature, score in importance.items():
        logger.info(f"  {feature}: {score:.4f}")
    
    return importance


def save_model(
    model: xgb.XGBRegressor,
    output_path: str,
    metrics: Dict[str, float],
    feature_importance: Dict[str, float],
):
    """Save model and metadata"""
    
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Save model
    model_path = output_path.with_suffix(".json")
    model.save_model(str(model_path))
    logger.info(f"Model saved to {model_path}")
    
    # Save metadata
    metadata = {
        "version": datetime.now().strftime("v%Y%m%d_%H%M%S"),
        "trained_at": datetime.now().isoformat(),
        "feature_columns": FEATURE_COLUMNS,
        "metrics": metrics,
        "feature_importance": feature_importance,
        "model_params": model.get_params(),
    }
    
    metadata_path = output_path.with_suffix(".meta.json")
    with open(metadata_path, "w") as f:
        json.dump(metadata, f, indent=2)
    logger.info(f"Metadata saved to {metadata_path}")


def main():
    """Main training pipeline"""
    
    parser = argparse.ArgumentParser(description="Train ETA prediction model")
    parser.add_argument(
        "--data-path",
        type=str,
        default="data/training_data.csv",
        help="Path to training data CSV",
    )
    parser.add_argument(
        "--output-path",
        type=str,
        default="models/eta_model",
        help="Path to save trained model",
    )
    parser.add_argument(
        "--test-size",
        type=float,
        default=0.2,
        help="Test set proportion",
    )
    parser.add_argument(
        "--tune",
        action="store_true",
        help="Enable hyperparameter tuning",
    )
    
    args = parser.parse_args()
    
    # Check if data exists
    if not Path(args.data_path).exists():
        logger.error(f"Training data not found at {args.data_path}")
        logger.info("Generate sample data using: python -m app.training.generate_sample_data")
        return
    
    # Load data
    df = load_training_data(args.data_path)
    X, y = prepare_features(df)
    
    # Split data
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=args.test_size, random_state=42
    )
    X_train, X_val, y_train, y_val = train_test_split(
        X_train, y_train, test_size=0.1, random_state=42
    )
    
    logger.info(f"Train set: {len(X_train)}, Val set: {len(X_val)}, Test set: {len(X_test)}")
    
    # Get parameters
    if args.tune:
        params = tune_hyperparameters(X_train, y_train)
        params.update(get_default_params())
        params.update(tune_hyperparameters(X_train, y_train))
    else:
        params = get_default_params()
    
    # Train model
    model = train_model(X_train, y_train, X_val, y_val, params)
    
    # Evaluate
    metrics = evaluate_model(model, X_test, y_test)
    feature_importance = analyze_feature_importance(model, FEATURE_COLUMNS)
    
    # Save
    save_model(model, args.output_path, metrics, feature_importance)
    
    logger.info("\nTraining complete!")


if __name__ == "__main__":
    main()
