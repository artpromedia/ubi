/*
 * Authentication Middleware
 */

package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
	"github.com/rs/zerolog/log"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/redis"
)

// ContextKey type for context keys
type ContextKey string

const (
	UserIDKey   ContextKey = "userId"
	UserRoleKey ContextKey = "userRole"
	UserEmailKey ContextKey = "userEmail"
)

// Claims represents JWT claims
type Claims struct {
	UserID   string `json:"userId"`
	Email    string `json:"email"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

// Auth middleware for JWT authentication
func Auth(rdb *redis.Client, jwtSecret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				respondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Missing authorization header")
				return
			}

			if !strings.HasPrefix(authHeader, "Bearer ") {
				respondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Invalid authorization format")
				return
			}

			tokenString := strings.TrimPrefix(authHeader, "Bearer ")

			// Check if token is blacklisted
			blacklisted, err := rdb.Exists(r.Context(), "token:blacklist:"+tokenString)
			if err != nil {
				log.Error().Err(err).Msg("Failed to check token blacklist")
			}
			if blacklisted {
				respondError(w, http.StatusUnauthorized, "TOKEN_REVOKED", "Token has been revoked")
				return
			}

			// Parse and validate token
			token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
				return []byte(jwtSecret), nil
			})

			if err != nil {
				if err == jwt.ErrTokenExpired {
					respondError(w, http.StatusUnauthorized, "TOKEN_EXPIRED", "Token has expired")
					return
				}
				respondError(w, http.StatusUnauthorized, "INVALID_TOKEN", "Invalid token")
				return
			}

			claims, ok := token.Claims.(*Claims)
			if !ok || !token.Valid {
				respondError(w, http.StatusUnauthorized, "INVALID_TOKEN", "Invalid token claims")
				return
			}

			// Add user info to context
			ctx := context.WithValue(r.Context(), UserIDKey, claims.UserID)
			ctx = context.WithValue(ctx, UserRoleKey, claims.Role)
			ctx = context.WithValue(ctx, UserEmailKey, claims.Email)

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// DriverOnly middleware ensures user is a driver
func DriverOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		role := r.Context().Value(UserRoleKey).(string)

		if role != "DRIVER" && role != "ADMIN" {
			respondError(w, http.StatusForbidden, "FORBIDDEN", "Driver access required")
			return
		}

		next.ServeHTTP(w, r)
	})
}

// AdminOnly middleware ensures user is an admin
func AdminOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		role := r.Context().Value(UserRoleKey).(string)

		if role != "ADMIN" {
			respondError(w, http.StatusForbidden, "FORBIDDEN", "Admin access required")
			return
		}

		next.ServeHTTP(w, r)
	})
}

// ServiceAuth middleware for service-to-service auth
func ServiceAuth(serviceKey string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := r.Header.Get("X-Service-Key")

			if key != serviceKey {
				respondError(w, http.StatusForbidden, "FORBIDDEN", "Invalid service key")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// GetUserID extracts user ID from context
func GetUserID(ctx context.Context) string {
	if id, ok := ctx.Value(UserIDKey).(string); ok {
		return id
	}
	return ""
}

// GetUserRole extracts user role from context
func GetUserRole(ctx context.Context) string {
	if role, ok := ctx.Value(UserRoleKey).(string); ok {
		return role
	}
	return ""
}

func respondError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write([]byte(`{"success":false,"error":{"code":"` + code + `","message":"` + message + `"}}`))
}
