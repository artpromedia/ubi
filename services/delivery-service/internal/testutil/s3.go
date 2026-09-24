package testutil

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/rclone/gofakes3"
	"github.com/rclone/gofakes3/s3mem"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/config"
)

// Proof storage for the tests is a REAL S3 protocol endpoint that verifies
// SigV4 signatures — presigned URLs included, with their expiry — because
// the properties under test (an expired URL is refused, an unsigned request
// is refused, the object in the bucket is exactly what was verified) are the
// storage server's to enforce, and a store that accepted anything would only
// prove the handlers agree with themselves.
//
//   - DELIVERY_TEST_S3_ENDPOINT (+ DELIVERY_TEST_S3_ACCESS_KEY /
//     DELIVERY_TEST_S3_SECRET_KEY): a real S3-compatible server, e.g. the
//     MinIO the production stack runs. Each harness creates its own bucket
//     and removes it afterwards.
//   - otherwise: an in-process S3 server (github.com/rclone/gofakes3, the
//     S3 implementation rclone's `serve s3` ships) with V4 authentication ON,
//     on an httptest listener — so CI, which has no MinIO service, still
//     exercises real presigned-URL signing, expiry and anonymous refusal.
//
// S3Backend names which one a run used.

const (
	testS3Region    = "us-east-1"
	inProcessAccess = "ubi-proofs-test-access"
	inProcessSecret = "ubi-proofs-test-secret-key-000001"
)

// TestS3 is one test's proof bucket.
type TestS3 struct {
	Config  config.ProofStorageConfig
	Backend string // "external:<endpoint>" or "in-process gofakes3"
	// Admin is a credentialed client on the same bucket, for tests that put
	// bytes into the bucket directly (a tampered or replaced object) or look
	// at what is stored.
	Admin *minio.Client
}

func randomSuffix() string {
	raw := make([]byte, 6)
	_, _ = rand.Read(raw)
	return hex.EncodeToString(raw)
}

// NewTestS3 provisions a fresh, private proof bucket for one test.
func NewTestS3(t *testing.T) *TestS3 {
	t.Helper()
	endpoint := envOr([]string{"DELIVERY_TEST_S3_ENDPOINT"}, "")
	access := envOr([]string{"DELIVERY_TEST_S3_ACCESS_KEY"}, "")
	secret := envOr([]string{"DELIVERY_TEST_S3_SECRET_KEY"}, "")
	backend := "external:" + endpoint

	if endpoint == "" {
		faker := gofakes3.New(s3mem.New(),
			gofakes3.WithV4Auth(map[string]string{inProcessAccess: inProcessSecret}),
			gofakes3.WithTimeSkewLimit(15*time.Minute),
		)
		server := httptest.NewServer(faker.Server())
		t.Cleanup(server.Close)
		endpoint, access, secret = server.URL, inProcessAccess, inProcessSecret
		backend = "in-process gofakes3"
	}

	bucket := "ubi-proofs-" + randomSuffix()
	cfg := config.ProofStorageConfig{
		Endpoint:    endpoint,
		Region:      testS3Region,
		Bucket:      bucket,
		AccessKey:   access,
		SecretKey:   secret,
		UploadTTL:   config.DefaultProofUploadTTL,
		DownloadTTL: config.DefaultProofDownloadTTL,
	}

	host := strings.TrimPrefix(strings.TrimPrefix(endpoint, "http://"), "https://")
	admin, err := minio.New(host, &minio.Options{
		Creds:        credentials.NewStaticV4(access, secret, ""),
		Secure:       strings.HasPrefix(endpoint, "https://"),
		Region:       testS3Region,
		BucketLookup: minio.BucketLookupPath,
	})
	if err != nil {
		t.Fatalf("build the test S3 admin client: %v", err)
	}
	ctx := context.Background()
	if err := admin.MakeBucket(ctx, bucket, minio.MakeBucketOptions{Region: testS3Region}); err != nil {
		t.Fatalf("create the test proof bucket on %s: %v", backend, err)
	}
	t.Cleanup(func() {
		cleanup := context.Background()
		for object := range admin.ListObjects(cleanup, bucket, minio.ListObjectsOptions{Recursive: true}) {
			if object.Err == nil {
				_ = admin.RemoveObject(cleanup, bucket, object.Key, minio.RemoveObjectOptions{})
			}
		}
		_ = admin.RemoveBucket(cleanup, bucket)
	})
	t.Logf("proof storage backend: %s (bucket %s)", backend, bucket)
	return &TestS3{Config: cfg, Backend: backend, Admin: admin}
}
