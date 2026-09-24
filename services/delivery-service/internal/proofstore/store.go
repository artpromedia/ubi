// Package proofstore is delivery-service's view of the private, S3-compatible
// bucket custody proofs (pickup/delivery/return photos and signatures) live in
// — MinIO in the Hetzner stack (P17, recheck R02).
//
// The rules it exists to keep:
//
//   - the bucket is PRIVATE. Nothing here makes an object public, and Check
//     refuses a bucket whose policy grants anonymous access, so readiness
//     never blesses a public proof bucket;
//   - uploads are server-issued: PresignPut signs a single PUT of exactly one
//     server-generated key, for minutes, with the declared Content-Type and
//     SHA-256 checksum as signed headers (a real S3/MinIO rejects bytes whose
//     checksum does not match; delivery-service re-verifies the stored bytes
//     itself on attach either way — see handlers.verifyProofObject);
//   - downloads are short-lived presigned GETs minted only after the caller's
//     entitlement was checked (handlers.GetProofURL). There is no proxy, no
//     public URL, no long-lived link.
//
// Two clients: `internal` talks to Endpoint (reachable from this service);
// `presigner` signs URLs for PublicEndpoint, the host a phone reaches. Signing
// is offline (the region is configured, so no bucket-location lookup), so the
// public host need not be reachable from inside the cluster.
package proofstore

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/config"
)

// ErrNotFound is returned by Stat/Open for an object that does not exist.
var ErrNotFound = errors.New("proof object not found")

// ErrNotConfigured is what every operation answers on the unconfigured store.
var ErrNotConfigured = errors.New("proof object storage is not configured")

// ObjectInfo is what Stat reports about a stored object.
type ObjectInfo struct {
	Size        int64
	ContentType string
}

// Store is the proof bucket. Implementations must never expose an object
// publicly.
type Store interface {
	// Configured reports whether this is a usable store (false for the
	// fail-closed stand-in NewFromConfig returns when nothing is configured).
	Configured() bool
	// PresignPut signs one PUT of key, valid for ttl. The returned headers
	// are signed into the URL and must be sent exactly.
	PresignPut(ctx context.Context, key, contentType, sha256Hex string, ttl time.Duration) (*url.URL, http.Header, error)
	// PresignGet signs one GET of key, valid for ttl.
	PresignGet(ctx context.Context, key string, ttl time.Duration) (*url.URL, error)
	Stat(ctx context.Context, key string) (ObjectInfo, error)
	Open(ctx context.Context, key string) (io.ReadCloser, error)
	Remove(ctx context.Context, key string) error
	// Check proves the bucket is reachable, exists, and is private.
	Check(ctx context.Context) error
}

// NewFromConfig builds the store from configuration. An unconfigured
// configuration yields the fail-closed stand-in (never nil, never a store
// that pretends), so callers need exactly one code path.
func NewFromConfig(cfg config.ProofStorageConfig) (Store, error) {
	if !cfg.Configured() {
		return Unconfigured{}, nil
	}
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return NewS3(cfg)
}

// Unconfigured is the fail-closed store: every operation refuses.
type Unconfigured struct{}

func (Unconfigured) Configured() bool { return false }
func (Unconfigured) PresignPut(context.Context, string, string, string, time.Duration) (*url.URL, http.Header, error) {
	return nil, nil, ErrNotConfigured
}
func (Unconfigured) PresignGet(context.Context, string, time.Duration) (*url.URL, error) {
	return nil, ErrNotConfigured
}
func (Unconfigured) Stat(context.Context, string) (ObjectInfo, error) {
	return ObjectInfo{}, ErrNotConfigured
}
func (Unconfigured) Open(context.Context, string) (io.ReadCloser, error) {
	return nil, ErrNotConfigured
}
func (Unconfigured) Remove(context.Context, string) error { return ErrNotConfigured }
func (Unconfigured) Check(context.Context) error          { return ErrNotConfigured }

// S3 is the minio-go backed store.
type S3 struct {
	internal  *minio.Client
	presigner *minio.Client
	bucket    string
}

func newClient(endpoint string, cfg config.ProofStorageConfig) (*minio.Client, error) {
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return nil, fmt.Errorf("parse proof storage endpoint: %w", err)
	}
	return minio.New(parsed.Host, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: parsed.Scheme == "https",
		// A fixed region makes presigning offline and avoids a location
		// lookup on every request.
		Region:       cfg.Region,
		BucketLookup: minio.BucketLookupPath,
	})
}

// NewS3 builds the minio-go store for a configured ProofStorageConfig.
func NewS3(cfg config.ProofStorageConfig) (*S3, error) {
	if cfg.Region == "" {
		cfg.Region = "us-east-1"
	}
	internal, err := newClient(cfg.Endpoint, cfg)
	if err != nil {
		return nil, err
	}
	public := cfg.PublicEndpoint
	if public == "" {
		public = cfg.Endpoint
	}
	presigner, err := newClient(public, cfg)
	if err != nil {
		return nil, err
	}
	return &S3{internal: internal, presigner: presigner, bucket: cfg.Bucket}, nil
}

// Configured is always true for a built S3 store.
func (s *S3) Configured() bool { return true }

// ChecksumHeader is the S3 additional-checksum header PresignPut signs.
const ChecksumHeader = "X-Amz-Checksum-Sha256"

// SHA256Base64 converts a lowercase hex SHA-256 into the base64 form the
// S3 checksum header carries.
func SHA256Base64(sha256Hex string) (string, error) {
	raw, err := hex.DecodeString(sha256Hex)
	if err != nil || len(raw) != sha256.Size {
		return "", fmt.Errorf("sha256 must be a 64-character hex digest")
	}
	return base64.StdEncoding.EncodeToString(raw), nil
}

// PresignPut signs a single PUT of key with Content-Type and the SHA-256
// checksum as signed headers.
func (s *S3) PresignPut(ctx context.Context, key, contentType, sha256Hex string, ttl time.Duration) (*url.URL, http.Header, error) {
	checksum, err := SHA256Base64(sha256Hex)
	if err != nil {
		return nil, nil, err
	}
	headers := http.Header{}
	headers.Set("Content-Type", contentType)
	headers.Set(ChecksumHeader, checksum)
	signed, err := s.presigner.PresignHeader(ctx, http.MethodPut, s.bucket, key, ttl, nil, headers)
	if err != nil {
		return nil, nil, fmt.Errorf("presign proof upload: %w", err)
	}
	return signed, headers, nil
}

// PresignGet signs a single GET of key. The response is marked private and
// uncacheable by a signed response-cache-control override.
func (s *S3) PresignGet(ctx context.Context, key string, ttl time.Duration) (*url.URL, error) {
	params := url.Values{}
	params.Set("response-cache-control", "private, no-store")
	signed, err := s.presigner.PresignedGetObject(ctx, s.bucket, key, ttl, params)
	if err != nil {
		return nil, fmt.Errorf("presign proof download: %w", err)
	}
	return signed, nil
}

func isNotFound(err error) bool {
	code := minio.ToErrorResponse(err).Code
	return code == "NoSuchKey" || code == "NotFound" || code == "NoSuchObject"
}

// Stat reports an object's size and stored content type.
func (s *S3) Stat(ctx context.Context, key string) (ObjectInfo, error) {
	info, err := s.internal.StatObject(ctx, s.bucket, key, minio.StatObjectOptions{})
	if err != nil {
		if isNotFound(err) {
			return ObjectInfo{}, ErrNotFound
		}
		return ObjectInfo{}, fmt.Errorf("stat proof object: %w", err)
	}
	return ObjectInfo{Size: info.Size, ContentType: info.ContentType}, nil
}

// Open streams an object's bytes.
func (s *S3) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	obj, err := s.internal.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		if isNotFound(err) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("open proof object: %w", err)
	}
	return obj, nil
}

// Remove deletes an object (a rejected upload's bytes). Removing an absent
// object is not an error.
func (s *S3) Remove(ctx context.Context, key string) error {
	if err := s.internal.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{}); err != nil && !isNotFound(err) {
		return fmt.Errorf("remove proof object: %w", err)
	}
	return nil
}

// Check proves the bucket exists, is reachable with these credentials, and
// grants nothing to anonymous callers.
func (s *S3) Check(ctx context.Context) error {
	exists, err := s.internal.BucketExists(ctx, s.bucket)
	if err != nil {
		return fmt.Errorf("proof bucket %q is unreachable: %w", s.bucket, err)
	}
	if !exists {
		return fmt.Errorf("proof bucket %q does not exist", s.bucket)
	}
	policy, err := s.internal.GetBucketPolicy(ctx, s.bucket)
	if err != nil {
		switch minio.ToErrorResponse(err).Code {
		case "NoSuchBucketPolicy":
			return nil
		case "NotImplemented":
			// A server without bucket policies has no way to grant anonymous
			// access at all, which is exactly the private posture wanted.
			return nil
		}
		return fmt.Errorf("proof bucket %q policy is unreadable: %w", s.bucket, err)
	}
	if policyUnsupported(policy) {
		// The server answered the ?policy subresource with something that is
		// not a policy document at all (an S3 implementation without bucket
		// policies routes it as a plain bucket read): there is no policy that
		// could grant anonymous access.
		return nil
	}
	if PolicyGrantsAnonymous(policy) {
		return fmt.Errorf("proof bucket %q has a policy granting anonymous access; custody proofs must never be public", s.bucket)
	}
	return nil
}

// policyUnsupported reports a ?policy answer that is an XML document rather
// than a JSON policy — how an S3 implementation without bucket policies
// answers. Anything else that fails to parse still counts as public
// (PolicyGrantsAnonymous fails closed).
func policyUnsupported(policy string) bool {
	return strings.HasPrefix(strings.TrimSpace(policy), "<")
}

// PolicyGrantsAnonymous reports whether an S3 bucket policy document has an
// Allow statement for the anonymous principal ("*" or {"AWS": "*"}). Pure —
// unit-tested without a server.
func PolicyGrantsAnonymous(policy string) bool {
	if strings.TrimSpace(policy) == "" {
		return false
	}
	var doc struct {
		Statement []struct {
			Effect    string          `json:"Effect"`
			Principal json.RawMessage `json:"Principal"`
		} `json:"Statement"`
	}
	if err := json.Unmarshal([]byte(policy), &doc); err != nil {
		// Unparseable is not provably private.
		return true
	}
	for _, statement := range doc.Statement {
		if !strings.EqualFold(statement.Effect, "Allow") {
			continue
		}
		if principalIsAnonymous(statement.Principal) {
			return true
		}
	}
	return false
}

func principalIsAnonymous(raw json.RawMessage) bool {
	var single string
	if err := json.Unmarshal(raw, &single); err == nil {
		return single == "*"
	}
	var mapped map[string]json.RawMessage
	if err := json.Unmarshal(raw, &mapped); err != nil {
		return false
	}
	for _, value := range mapped {
		var one string
		if err := json.Unmarshal(value, &one); err == nil && one == "*" {
			return true
		}
		var many []string
		if err := json.Unmarshal(value, &many); err == nil {
			for _, entry := range many {
				if entry == "*" {
					return true
				}
			}
		}
	}
	return false
}
