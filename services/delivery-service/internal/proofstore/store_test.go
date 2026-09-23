package proofstore_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/config"
	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/proofstore"
	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/testutil"
)

func TestPolicyGrantsAnonymous(t *testing.T) {
	cases := []struct {
		name   string
		policy string
		want   bool
	}{
		{"no policy", "", false},
		{"principal star", `{"Statement":[{"Effect":"Allow","Principal":"*","Action":["s3:GetObject"],"Resource":["arn:aws:s3:::b/*"]}]}`, true},
		{"AWS star", `{"Statement":[{"Effect":"Allow","Principal":{"AWS":"*"},"Action":"s3:GetObject"}]}`, true},
		{"AWS list with star", `{"Statement":[{"Effect":"Allow","Principal":{"AWS":["arn:aws:iam::1:root","*"]},"Action":"s3:GetObject"}]}`, true},
		{"deny star only", `{"Statement":[{"Effect":"Deny","Principal":"*","Action":"s3:*"}]}`, false},
		{"named principal", `{"Statement":[{"Effect":"Allow","Principal":{"AWS":["arn:aws:iam::1:user/app"]},"Action":"s3:GetObject"}]}`, false},
		{"unparseable fails closed", `{"Statement": nope`, true},
	}
	for _, testCase := range cases {
		if got := proofstore.PolicyGrantsAnonymous(testCase.policy); got != testCase.want {
			t.Fatalf("%s: got %v, want %v", testCase.name, got, testCase.want)
		}
	}
}

func TestSHA256Base64(t *testing.T) {
	encoded, err := proofstore.SHA256Base64(strings.Repeat("ab", 32))
	if err != nil || encoded != "q6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6s=" {
		t.Fatalf("encoded = %q, err = %v", encoded, err)
	}
	for _, bad := range []string{"", "zz", strings.Repeat("a", 63)} {
		if _, err := proofstore.SHA256Base64(bad); err == nil {
			t.Fatalf("%q must be refused", bad)
		}
	}
}

// An unconfigured store is the fail-closed stand-in, never nil and never a
// store that pretends.
func TestUnconfiguredStoreRefusesEverything(t *testing.T) {
	store, err := proofstore.NewFromConfig(config.ProofStorageConfig{})
	if err != nil {
		t.Fatalf("an empty configuration is 'unconfigured', not an error: %v", err)
	}
	if store.Configured() {
		t.Fatal("an empty configuration must not be a configured store")
	}
	ctx := context.Background()
	if _, _, err := store.PresignPut(ctx, "k", "image/png", strings.Repeat("a", 64), time.Minute); !errors.Is(err, proofstore.ErrNotConfigured) {
		t.Fatalf("PresignPut: %v", err)
	}
	if _, err := store.PresignGet(ctx, "k", time.Minute); !errors.Is(err, proofstore.ErrNotConfigured) {
		t.Fatalf("PresignGet: %v", err)
	}
	if _, err := store.Stat(ctx, "k"); !errors.Is(err, proofstore.ErrNotConfigured) {
		t.Fatalf("Stat: %v", err)
	}
	if err := store.Check(ctx); !errors.Is(err, proofstore.ErrNotConfigured) {
		t.Fatalf("Check: %v", err)
	}

	if _, err := proofstore.NewFromConfig(config.ProofStorageConfig{
		Endpoint: "minio:9000", Bucket: "b", AccessKey: "a", SecretKey: "s",
		UploadTTL: time.Minute, DownloadTTL: time.Minute,
	}); err == nil {
		t.Fatal("an endpoint without a scheme must be refused, not guessed")
	}
}

// Against the test S3 endpoint (MinIO or the in-process SigV4 server): the
// presigned PUT carries its signed headers, the object round-trips, the
// bucket checks as private, and a missing object is ErrNotFound.
func TestS3StoreAgainstARealEndpoint(t *testing.T) {
	s3 := testutil.NewTestS3(t)
	store, err := proofstore.NewFromConfig(s3.Config)
	if err != nil || !store.Configured() {
		t.Fatalf("build the store: %v", err)
	}
	ctx := context.Background()
	if err := store.Check(ctx); err != nil {
		t.Fatalf("a fresh private bucket must check out: %v", err)
	}

	image := testutil.TestImage("image/png", 7)
	signed, headers, err := store.PresignPut(ctx, "proofs/d/pickup/a/u", "image/png", testutil.SHA256Hex(image), time.Minute)
	if err != nil {
		t.Fatalf("presign: %v", err)
	}
	if headers.Get("Content-Type") != "image/png" || headers.Get(proofstore.ChecksumHeader) == "" {
		t.Fatalf("signed headers = %v", headers)
	}
	if !strings.Contains(signed.RawQuery, "X-Amz-SignedHeaders=") || !strings.Contains(strings.ToLower(signed.RawQuery), "content-type") {
		t.Fatalf("the content type must be a signed header: %s", signed.RawQuery)
	}
	put, err := http.NewRequest(http.MethodPut, signed.String(), bytes.NewReader(image))
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	for name := range headers {
		put.Header.Set(name, headers.Get(name))
	}
	resp, err := http.DefaultClient.Do(put)
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("PUT: %v %v", err, resp)
	}
	_ = resp.Body.Close()

	// A different Content-Type than the one signed is refused by storage.
	tampered, _ := http.NewRequest(http.MethodPut, signed.String(), bytes.NewReader(image))
	for name := range headers {
		tampered.Header.Set(name, headers.Get(name))
	}
	tampered.Header.Set("Content-Type", "text/html")
	resp, err = http.DefaultClient.Do(tampered)
	if err != nil {
		t.Fatalf("tampered PUT: %v", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode < 400 {
		t.Fatalf("a PUT with an unsigned content type must be refused, got %d", resp.StatusCode)
	}

	info, err := store.Stat(ctx, "proofs/d/pickup/a/u")
	if err != nil || info.Size != int64(len(image)) {
		t.Fatalf("stat = %+v, %v", info, err)
	}
	body, err := store.Open(ctx, "proofs/d/pickup/a/u")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	stored, _ := io.ReadAll(body)
	_ = body.Close()
	if !bytes.Equal(stored, image) {
		t.Fatal("the stored bytes must be exactly the uploaded ones")
	}
	if _, err := store.Stat(ctx, "proofs/d/pickup/a/missing"); !errors.Is(err, proofstore.ErrNotFound) {
		t.Fatalf("a missing object must be ErrNotFound, got %v", err)
	}
	if err := store.Remove(ctx, "proofs/d/pickup/a/u"); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if err := store.Remove(ctx, "proofs/d/pickup/a/u"); err != nil {
		t.Fatalf("removing an absent object is not an error: %v", err)
	}

	missing := s3.Config
	missing.Bucket = "ubi-proofs-does-not-exist"
	absent, err := proofstore.NewFromConfig(missing)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if err := absent.Check(ctx); err == nil {
		t.Fatal("a missing bucket must fail the check")
	}
}
