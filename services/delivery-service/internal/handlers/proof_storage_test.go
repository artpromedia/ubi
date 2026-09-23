package handlers_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/custody"
	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/testutil"
)

// Verified proof storage (P17, recheck R02), end to end: the real router,
// the real Prisma schema, and a real S3 protocol endpoint (MinIO when
// DELIVERY_TEST_S3_ENDPOINT is set, otherwise the in-process SigV4-verifying
// gofakes3 — see internal/testutil/s3.go). Every refusal is also checked to
// have left custody, proofs and the bucket as they were.

type proofRow struct {
	ObjectKey string
	SHA256    string
	UploadID  *string
	Verified  bool
}

func proofRows(t *testing.T, h *testutil.Harness, deliveryID string) []proofRow {
	t.Helper()
	rows, err := h.Pool.Query(context.Background(), `
		SELECT object_key, sha256, upload_id::text, verified_at IS NOT NULL
		FROM delivery_proofs WHERE delivery_id = $1 ORDER BY created_at`, deliveryID)
	if err != nil {
		t.Fatalf("query proofs: %v", err)
	}
	defer rows.Close()
	var out []proofRow
	for rows.Next() {
		var row proofRow
		if err := rows.Scan(&row.ObjectKey, &row.SHA256, &row.UploadID, &row.Verified); err != nil {
			t.Fatalf("scan proof: %v", err)
		}
		out = append(out, row)
	}
	return out
}

func custodyState(t *testing.T, h *testutil.Harness, deliveryID string) string {
	t.Helper()
	var state string
	if err := h.Pool.QueryRow(context.Background(), `SELECT state FROM delivery_custody WHERE delivery_id = $1`, deliveryID).Scan(&state); err != nil {
		t.Fatalf("custody state: %v", err)
	}
	return state
}

func uploadStatus(t *testing.T, h *testutil.Harness, uploadID string) (string, string) {
	t.Helper()
	var status, reason string
	if err := h.Pool.QueryRow(context.Background(), `SELECT status, COALESCE(reject_reason, '') FROM delivery_proof_uploads WHERE id = $1`, uploadID).Scan(&status, &reason); err != nil {
		t.Fatalf("upload status: %v", err)
	}
	return status, reason
}

func objectExists(t *testing.T, h *testutil.Harness, key string) bool {
	t.Helper()
	_, err := h.S3.Admin.StatObject(context.Background(), h.S3.Config.Bucket, key, minio.StatObjectOptions{})
	return err == nil
}

// putDirect writes bytes into the bucket with the admin credentials,
// bypassing the presigned URL: the object in the bucket is not what the
// driver declared, however it got there.
func putDirect(t *testing.T, h *testutil.Harness, key string, body []byte, contentType string) {
	t.Helper()
	if _, err := h.S3.Admin.PutObject(context.Background(), h.S3.Config.Bucket, key, bytes.NewReader(body), int64(len(body)),
		minio.PutObjectOptions{ContentType: contentType}); err != nil {
		t.Fatalf("write the object directly: %v", err)
	}
}

// storageAuthRefusals are the S3 error codes that mean "not authenticated":
// MinIO/S3 answer an expired or unsigned request with AccessDenied (403); the
// in-process gofakes3 answers an expired signature with AccessDenied (400)
// and a request carrying no SigV4 signature at all with UnsupportedAlgorithm
// (400). Any of them is the property under test — the request was refused
// for want of a valid signature.
var storageAuthRefusals = []string{"<Code>AccessDenied</Code>", "<Code>UnsupportedAlgorithm</Code>", "<Code>SignatureDoesNotMatch</Code>"}

// requireStorageDenied asserts the storage server refused a request as
// unauthenticated.
func requireStorageDenied(t *testing.T, what string, status int, body string) {
	t.Helper()
	if status != http.StatusForbidden && status != http.StatusBadRequest {
		t.Fatalf("%s: storage answered %d %s, want an authentication refusal", what, status, body)
	}
	for _, code := range storageAuthRefusals {
		if strings.Contains(body, code) {
			return
		}
	}
	t.Fatalf("%s: storage answered %d %s, want an authentication refusal", what, status, body)
}

func requireCode(t *testing.T, rec *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status = %d, want %d (body %s)", rec.Code, status, rec.Body.String())
	}
	var env apiEnvelope
	decode(t, rec, &env)
	if env.Error == nil || env.Error.Code != code {
		t.Fatalf("error = %+v, want %s (body %s)", env.Error, code, rec.Body.String())
	}
}

// TestProofUploadVerifyRetrieve: a driver's proof goes through a server-issued
// upload into the private bucket, is verified and attached, and can then be
// viewed ONLY through a seconds-long presigned GET by an entitled party.
func TestProofUploadVerifyRetrieve(t *testing.T) {
	h := testutil.NewHarness(t)
	ctx := context.Background()
	deliveryID, actors := h.SeedDelivery(ctx, testutil.Actor{}, testutil.Actor{}, "")
	image := testutil.TestImage("image/jpeg", 41)

	grant := h.MustRequestUpload(deliveryID, actors.Driver, testutil.DeclarationFor("pickup", "image/jpeg", image))
	// The key is the server's, namespaced to delivery, type and driver.
	wantPrefix := custody.ProofObjectKeyPrefix(deliveryID, "pickup", actors.Driver.UserID.String())
	if !strings.HasPrefix(grant.ObjectKey, wantPrefix) || !strings.HasSuffix(grant.ObjectKey, grant.UploadID) {
		t.Fatalf("object key %q is not the server-generated %s<uploadId>", grant.ObjectKey, wantPrefix)
	}
	if grant.Upload.Method != http.MethodPut || !strings.Contains(grant.Upload.URL, "X-Amz-Signature=") {
		t.Fatalf("expected a presigned PUT, got %+v", grant.Upload)
	}
	if until := time.Until(grant.ExpiresAt); until <= 0 || until > 6*time.Minute {
		t.Fatalf("an upload URL must be short-lived; expires in %s", until)
	}
	// Asking again for the same image re-signs the same slot.
	again := h.MustRequestUpload(deliveryID, actors.Driver, testutil.DeclarationFor("pickup", "image/jpeg", image))
	if !again.Replay || again.UploadID != grant.UploadID || again.ObjectKey != grant.ObjectKey {
		t.Fatalf("a repeated upload request must replay the open slot: %+v vs %+v", again, grant)
	}

	if status, body := h.PutToUpload(grant, image); status != http.StatusOK {
		t.Fatalf("presigned PUT: status = %d, body = %s", status, body)
	}
	rec := h.AttachProof(deliveryID, "/pickup-proof", actors.Driver, grant.UploadID)
	if rec.Code != http.StatusCreated {
		t.Fatalf("attach: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var attached struct {
		Data struct {
			ProofID  string `json:"proofId"`
			Verified bool   `json:"verified"`
		} `json:"data"`
	}
	decode(t, rec, &attached)
	rows := proofRows(t, h, deliveryID)
	if len(rows) != 1 || !rows[0].Verified || rows[0].UploadID == nil || *rows[0].UploadID != grant.UploadID ||
		rows[0].SHA256 != testutil.SHA256Hex(image) || rows[0].ObjectKey != grant.ObjectKey {
		t.Fatalf("expected one verified proof bound to its upload, got %+v", rows)
	}
	if status, _ := uploadStatus(t, h, grant.UploadID); status != "attached" {
		t.Fatalf("upload status = %q, want attached", status)
	}
	if custodyState(t, h, deliveryID) != "in_transit" {
		t.Fatal("a verified pickup proof must move custody to in_transit")
	}

	// The timeline lists the proof — metadata, no URL.
	timeline := h.Do(req(http.MethodGet, custodyPath(deliveryID, "/"), nil), actors.Sender)
	if timeline.Code != http.StatusOK || !strings.Contains(timeline.Body.String(), attached.Data.ProofID) ||
		strings.Contains(timeline.Body.String(), "X-Amz-Signature") {
		t.Fatalf("timeline must list the proof without any URL: %s", timeline.Body.String())
	}

	urlPath := custodyPath(deliveryID, "/proofs/"+attached.Data.ProofID+"/url")
	for name, actor := range map[string]testutil.Actor{"sender": actors.Sender, "driver": actors.Driver} {
		rec := h.Do(req(http.MethodGet, urlPath, nil), actor)
		if rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s proof url: status = %d, cache = %q, body = %s", name, rec.Code, rec.Header().Get("Cache-Control"), rec.Body.String())
		}
		var got struct {
			Data struct {
				URL       string    `json:"url"`
				ExpiresAt time.Time `json:"expiresAt"`
			} `json:"data"`
		}
		decode(t, rec, &got)
		if until := time.Until(got.Data.ExpiresAt); until <= 0 || until > 61*time.Second {
			t.Fatalf("%s: a download URL must live seconds, expires in %s", name, until)
		}
		status, body, err := testutil.FetchURL(got.Data.URL)
		if err != nil || status != http.StatusOK || !bytes.Equal(body, image) {
			t.Fatalf("%s: fetching the presigned GET: status = %d, err = %v, bytes equal = %v", name, status, err, bytes.Equal(body, image))
		}
	}

	// Entitlement: an unrelated driver or rider sees nothing.
	for name, actor := range map[string]testutil.Actor{"foreign driver": testutil.Driver(), "foreign sender": testutil.Sender()} {
		if rec := h.Do(req(http.MethodGet, urlPath, nil), actor); rec.Code != http.StatusNotFound {
			t.Fatalf("%s asking for a proof URL: status = %d, want 404", name, rec.Code)
		}
	}
	// A proof id from another delivery answers 404 too.
	if rec := h.Do(req(http.MethodGet, custodyPath(deliveryID, "/proofs/"+uuid.New().String()+"/url"), nil), actors.Sender); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown proof: status = %d, want 404", rec.Code)
	}

	// Never public: the object's plain URL, unsigned, is refused by storage.
	status, body, err := testutil.FetchURL(h.UnsignedObjectURL(grant.ObjectKey))
	if err != nil {
		t.Fatalf("anonymous GET: %v", err)
	}
	requireStorageDenied(t, "anonymous GET of a proof object", status, string(body))
	if bytes.Contains(body, image[:64]) {
		t.Fatal("an anonymous request must never receive proof bytes")
	}
}

// TestProofChecksumMismatchIsRejected: bytes whose SHA-256 is not the declared
// one never become a proof — whether the storage server refuses them at the
// presigned PUT (MinIO checks the signed checksum header) or they reach the
// bucket and are caught by delivery-service's own re-hash on attach.
func TestProofChecksumMismatchIsRejected(t *testing.T) {
	h := testutil.NewHarness(t)
	ctx := context.Background()
	deliveryID, actors := h.SeedDelivery(ctx, testutil.Actor{}, testutil.Actor{}, "")
	declared := testutil.TestImage("image/png", 51)
	other := testutil.TestImage("image/png", 52)

	// Through the presigned URL: different bytes, same length or not.
	grant := h.MustRequestUpload(deliveryID, actors.Driver, testutil.DeclarationFor("pickup", "image/png", declared))
	putStatus, putBody := h.PutToUpload(grant, other)
	rec := h.AttachProof(deliveryID, "/pickup-proof", actors.Driver, grant.UploadID)
	t.Logf("%s answered the mismatched presigned PUT with %d; the attach answered %d", h.S3.Backend, putStatus, rec.Code)
	if putStatus != http.StatusOK && !strings.Contains(putBody, "Checksum") && !strings.Contains(putBody, "Digest") {
		t.Fatalf("storage refused the mismatched PUT for an unexpected reason: %d %s", putStatus, putBody)
	}
	if putStatus == http.StatusOK {
		// The store accepted the bytes: the attach must catch them.
		if rec.Code != http.StatusUnprocessableEntity {
			t.Fatalf("attach of mismatched bytes: status = %d, body = %s", rec.Code, rec.Body.String())
		}
	} else if rec.Code == http.StatusCreated || rec.Code == http.StatusOK {
		t.Fatalf("storage refused the PUT (%d) yet the attach succeeded: %s", putStatus, rec.Body.String())
	}

	// Deterministically on both backends: the object in the bucket is
	// replaced with different bytes of the declared size.
	tampered := testutil.TestImage("image/png", 53)
	grant2 := h.MustRequestUpload(deliveryID, actors.Driver, testutil.DeclarationFor("pickup", "image/png", tampered))
	flipped := append([]byte(nil), tampered...)
	flipped[len(flipped)-5] ^= 0xFF
	putDirect(t, h, grant2.ObjectKey, flipped, "image/png")
	rec = h.AttachProof(deliveryID, "/pickup-proof", actors.Driver, grant2.UploadID)
	requireCode(t, rec, http.StatusUnprocessableEntity, "PROOF_CHECKSUM_MISMATCH")
	if status, reason := uploadStatus(t, h, grant2.UploadID); status != "rejected" || reason != "checksum_mismatch" {
		t.Fatalf("upload = %s/%s, want rejected/checksum_mismatch", status, reason)
	}
	if objectExists(t, h, grant2.ObjectKey) {
		t.Fatal("a rejected object must be deleted from the proof bucket")
	}
	// A rejected upload stays rejected.
	requireCode(t, h.AttachProof(deliveryID, "/pickup-proof", actors.Driver, grant2.UploadID), http.StatusConflict, "PROOF_UPLOAD_REJECTED")

	if rows := proofRows(t, h, deliveryID); len(rows) != 0 {
		t.Fatalf("no proof may be recorded from mismatched bytes, got %+v", rows)
	}
	if custodyState(t, h, deliveryID) != "courier_assigned" {
		t.Fatal("custody must not move on a rejected proof")
	}
}

// TestProofWrongActorIsRefused: a proof can only be attached by the custody
// actor its upload was issued to, for the delivery and proof type it was
// issued for.
func TestProofWrongActorIsRefused(t *testing.T) {
	h := testutil.NewHarness(t)
	ctx := context.Background()
	deliveryID, actors := h.SeedDelivery(ctx, testutil.Actor{}, testutil.Actor{}, "")
	uploadID := h.UploadProof(deliveryID, actors.Driver, "pickup", testutil.TestImage("image/png", 61))

	// The sender is a party but not a driver.
	requireCode(t, h.AttachProof(deliveryID, "/pickup-proof", actors.Sender, uploadID), http.StatusForbidden, "FORBIDDEN")
	requireCode(t, h.RequestUpload(deliveryID, actors.Sender, testutil.DeclarationFor("pickup", "image/png", testutil.TestImage("image/png", 62))), http.StatusForbidden, "FORBIDDEN")

	// The same driver cannot attach it as another proof type…
	if _, err := h.Pool.Exec(ctx, `UPDATE delivery_custody SET state = 'in_transit' WHERE delivery_id = $1`, deliveryID); err != nil {
		t.Fatalf("move custody: %v", err)
	}
	requireCode(t, h.AttachProof(deliveryID, "/delivery-proof", actors.Driver, uploadID), http.StatusConflict, "PROOF_UPLOAD_TYPE_MISMATCH")
	if _, err := h.Pool.Exec(ctx, `UPDATE delivery_custody SET state = 'courier_assigned' WHERE delivery_id = $1`, deliveryID); err != nil {
		t.Fatalf("move custody back: %v", err)
	}

	// …nor on another delivery it is also assigned to.
	otherDelivery, _ := h.SeedDelivery(ctx, testutil.Actor{}, actors.Driver, "")
	requireCode(t, h.AttachProof(otherDelivery, "/pickup-proof", actors.Driver, uploadID), http.StatusNotFound, "PROOF_UPLOAD_NOT_FOUND")

	// The delivery is reassigned: the new driver may not attach the old
	// driver's upload.
	newDriver := testutil.Driver()
	if _, err := h.Pool.Exec(ctx, `UPDATE delivery_custody SET driver_id = $2 WHERE delivery_id = $1`, deliveryID, newDriver.UserID.String()); err != nil {
		t.Fatalf("reassign: %v", err)
	}
	requireCode(t, h.AttachProof(deliveryID, "/pickup-proof", newDriver, uploadID), http.StatusForbidden, "PROOF_UPLOAD_NOT_YOURS")
	// And the old driver, no longer assigned, is now a stranger.
	if rec := h.AttachProof(deliveryID, "/pickup-proof", actors.Driver, uploadID); rec.Code != http.StatusNotFound {
		t.Fatalf("the unassigned driver: status = %d, want 404", rec.Code)
	}

	if rows := proofRows(t, h, deliveryID); len(rows) != 0 {
		t.Fatalf("no proof may be attached by the wrong actor, got %+v", rows)
	}
	if status, _ := uploadStatus(t, h, uploadID); status != "issued" {
		t.Fatalf("a refused attach must leave the upload untouched, got %s", status)
	}
}

// TestProofExpiredUploadURLIsRefused: a presigned PUT stops working when it
// expires, and nothing can be attached from it.
func TestProofExpiredUploadURLIsRefused(t *testing.T) {
	h := testutil.NewHarnessWith(t, testutil.Options{UploadTTL: time.Second})
	ctx := context.Background()
	deliveryID, actors := h.SeedDelivery(ctx, testutil.Actor{}, testutil.Actor{}, "")
	image := testutil.TestImage("image/png", 71)
	grant := h.MustRequestUpload(deliveryID, actors.Driver, testutil.DeclarationFor("pickup", "image/png", image))

	time.Sleep(2500 * time.Millisecond)
	status, body := h.PutToUpload(grant, image)
	requireStorageDenied(t, "PUT to an expired upload URL", status, body)
	requireCode(t, h.AttachProof(deliveryID, "/pickup-proof", actors.Driver, grant.UploadID), http.StatusConflict, "PROOF_OBJECT_MISSING")
	if objectExists(t, h, grant.ObjectKey) {
		t.Fatal("an expired URL must not have stored anything")
	}
}

// TestProofExpiredDownloadURLIsRefused: a presigned GET stops working when it
// expires.
func TestProofExpiredDownloadURLIsRefused(t *testing.T) {
	h := testutil.NewHarnessWith(t, testutil.Options{DownloadTTL: time.Second})
	ctx := context.Background()
	deliveryID, actors := h.SeedDelivery(ctx, testutil.Actor{}, testutil.Actor{}, "")
	rec := h.ProveStep(deliveryID, actors.Driver, "pickup", "/pickup-proof", 72)
	var attached struct {
		Data struct {
			ProofID string `json:"proofId"`
		} `json:"data"`
	}
	decode(t, rec, &attached)
	urlRec := h.Do(req(http.MethodGet, custodyPath(deliveryID, "/proofs/"+attached.Data.ProofID+"/url"), nil), actors.Sender)
	var got struct {
		Data struct {
			URL string `json:"url"`
		} `json:"data"`
	}
	decode(t, urlRec, &got)
	if status, _, err := testutil.FetchURL(got.Data.URL); err != nil || status != http.StatusOK {
		t.Fatalf("a fresh download URL must work: status = %d, err = %v", status, err)
	}
	time.Sleep(2500 * time.Millisecond)
	status, body, err := testutil.FetchURL(got.Data.URL)
	if err != nil {
		t.Fatalf("expired download: %v", err)
	}
	requireStorageDenied(t, "an expired download URL", status, string(body))
}

// TestProofOversizedObjectIsRejected: an over-limit declaration is refused
// before any URL exists, and an object in the bucket larger than declared (or
// than any proof may be) is rejected and deleted on attach.
func TestProofOversizedObjectIsRejected(t *testing.T) {
	h := testutil.NewHarness(t)
	ctx := context.Background()
	deliveryID, actors := h.SeedDelivery(ctx, testutil.Actor{}, testutil.Actor{}, "")

	huge := testutil.DeclarationFor("pickup", "image/jpeg", []byte("x"))
	huge.SizeBytes = custody.MaxProofSizeBytes + 1
	requireCode(t, h.RequestUpload(deliveryID, actors.Driver, huge), http.StatusBadRequest, "VALIDATION_ERROR")

	// Declared small, stored huge: a JPEG header followed by 16 MiB.
	small := testutil.TestImage("image/jpeg", 81)
	grant := h.MustRequestUpload(deliveryID, actors.Driver, testutil.DeclarationFor("pickup", "image/jpeg", small))
	oversized := make([]byte, custody.MaxProofSizeBytes+1024)
	copy(oversized, small)
	_, _ = rand.Read(oversized[len(small):])
	putDirect(t, h, grant.ObjectKey, oversized, "image/jpeg")
	requireCode(t, h.AttachProof(deliveryID, "/pickup-proof", actors.Driver, grant.UploadID), http.StatusUnprocessableEntity, "PROOF_OBJECT_TOO_LARGE")
	if objectExists(t, h, grant.ObjectKey) {
		t.Fatal("an oversized object must be deleted")
	}

	// Declared N bytes, stored a different (smaller) size.
	grant2 := h.MustRequestUpload(deliveryID, actors.Driver, testutil.DeclarationFor("pickup", "image/jpeg", testutil.TestImage("image/jpeg", 82)))
	putDirect(t, h, grant2.ObjectKey, small[:len(small)/2], "image/jpeg")
	requireCode(t, h.AttachProof(deliveryID, "/pickup-proof", actors.Driver, grant2.UploadID), http.StatusUnprocessableEntity, "PROOF_SIZE_MISMATCH")

	if rows := proofRows(t, h, deliveryID); len(rows) != 0 {
		t.Fatalf("no proof may come from an oversized object, got %+v", rows)
	}
}

// TestProofContentIsSniffedNotTrusted: bytes that are not the declared image
// type (here an HTML page declared as a PNG, with its true checksum) are
// rejected, and a non-image type cannot even be declared.
func TestProofContentIsSniffedNotTrusted(t *testing.T) {
	h := testutil.NewHarness(t)
	ctx := context.Background()
	deliveryID, actors := h.SeedDelivery(ctx, testutil.Actor{}, testutil.Actor{}, "")

	requireCode(t, h.RequestUpload(deliveryID, actors.Driver, testutil.DeclarationFor("pickup", "text/html", []byte("<html></html>"))),
		http.StatusBadRequest, "VALIDATION_ERROR")

	page := []byte("<html><body><script>document.location='https://evil.example'</script></body></html>")
	uploadID := h.UploadProof(deliveryID, actors.Driver, "pickup", page) // declared image/png (helper default)
	requireCode(t, h.AttachProof(deliveryID, "/pickup-proof", actors.Driver, uploadID), http.StatusUnprocessableEntity, "PROOF_CONTENT_TYPE_MISMATCH")
	if rows := proofRows(t, h, deliveryID); len(rows) != 0 {
		t.Fatalf("no proof may come from a non-image, got %+v", rows)
	}
}

// TestProofClientAssertedReferenceIsRefused: the pre-P17 body — an object key
// and checksum the client merely asserts — is refused outright.
func TestProofClientAssertedReferenceIsRefused(t *testing.T) {
	h := testutil.NewHarness(t)
	ctx := context.Background()
	deliveryID, actors := h.SeedDelivery(ctx, testutil.Actor{}, testutil.Actor{}, "")
	legacy := map[string]interface{}{
		"objectKey": "deliveries/test/forged.jpg", "contentType": "image/jpeg",
		"sizeBytes": 204800, "sha256": strings.Repeat("a", 64),
	}
	requireCode(t, h.Do(req(http.MethodPost, custodyPath(deliveryID, "/pickup-proof"), legacy), actors.Driver),
		http.StatusBadRequest, "PROOF_UPLOAD_REQUIRED")
	// An upload that was issued but never PUT cannot be attached either.
	grant := h.MustRequestUpload(deliveryID, actors.Driver, testutil.DeclarationFor("pickup", "image/png", testutil.TestImage("image/png", 91)))
	requireCode(t, h.AttachProof(deliveryID, "/pickup-proof", actors.Driver, grant.UploadID), http.StatusConflict, "PROOF_OBJECT_MISSING")
	if rows := proofRows(t, h, deliveryID); len(rows) != 0 {
		t.Fatalf("no proof may exist without verified bytes, got %+v", rows)
	}
	if custodyState(t, h, deliveryID) != "courier_assigned" {
		t.Fatal("custody must not move without a verified proof")
	}
}

// TestLegacyUnverifiedProofIsNeverServed: a pre-P17 proof row (a
// client-asserted key, never verified) gets no download URL.
func TestLegacyUnverifiedProofIsNeverServed(t *testing.T) {
	h := testutil.NewHarness(t)
	ctx := context.Background()
	deliveryID, actors := h.SeedDelivery(ctx, testutil.Actor{}, testutil.Actor{}, "in_transit")
	var proofID string
	if err := h.Pool.QueryRow(ctx, `
		INSERT INTO delivery_proofs (delivery_id, custody_id, type, object_key, content_type, size_bytes, sha256, uploaded_by, uploaded_role, created_at)
		SELECT $1, id, 'pickup', 'deliveries/legacy/claimed.jpg', 'image/jpeg', 1024, $2, $3, 'driver', now()
		FROM delivery_custody WHERE delivery_id = $1
		RETURNING id::text`, deliveryID, strings.Repeat("b", 64), actors.Driver.UserID.String()).Scan(&proofID); err != nil {
		t.Fatalf("seed a legacy proof: %v", err)
	}
	requireCode(t, h.Do(req(http.MethodGet, custodyPath(deliveryID, "/proofs/"+proofID+"/url"), nil), actors.Sender),
		http.StatusConflict, "PROOF_NOT_VERIFIED")
}

// TestProofStorageUnconfiguredFailsClosed: without object storage, production
// refuses every proof operation and is not ready; development refuses the
// proof operations and says so in readiness.
func TestProofStorageUnconfiguredFailsClosed(t *testing.T) {
	const secret = "prod-gateway-context-key-for-tests"
	prod := testutil.NewHarnessWith(t, testutil.Options{Production: true, ContextSecret: secret, NoProofStorage: true})
	if err := prod.Cfg.ValidateProofStorage(); err == nil {
		t.Fatal("an unconfigured proof store must fail its validation")
	}
	deliveryID, actors := prod.SeedDelivery(context.Background(), testutil.Actor{}, testutil.Actor{}, "")
	image := testutil.TestImage("image/png", 95)

	requireCode(t, prod.DoSigned(req(http.MethodPost, custodyPath(deliveryID, "/proof-uploads"),
		testutil.DeclarationFor("pickup", "image/png", image)), actors.Driver), http.StatusServiceUnavailable, "PROOF_STORAGE_NOT_CONFIGURED")
	requireCode(t, prod.DoSigned(req(http.MethodPost, custodyPath(deliveryID, "/pickup-proof"), anyAttachBody()), actors.Driver),
		http.StatusServiceUnavailable, "PROOF_STORAGE_NOT_CONFIGURED")
	requireCode(t, prod.DoSigned(req(http.MethodGet, custodyPath(deliveryID, "/proofs/"+uuid.New().String()+"/url"), nil), actors.Sender),
		http.StatusServiceUnavailable, "PROOF_STORAGE_NOT_CONFIGURED")
	requireUntouched(t, prod, deliveryID)

	ready := serve(prod, httptest.NewRequest(http.MethodGet, "/health/ready", nil))
	if ready.Code != http.StatusServiceUnavailable || !strings.Contains(ready.Body.String(), `"proofStorage":{"error"`) {
		t.Fatalf("production readiness must refuse and name proof storage: status = %d, body = %s", ready.Code, ready.Body.String())
	}

	dev := testutil.NewHarnessWith(t, testutil.Options{NoProofStorage: true})
	devDelivery, devActors := dev.SeedDelivery(context.Background(), testutil.Actor{}, testutil.Actor{}, "")
	requireCode(t, dev.RequestUpload(devDelivery, devActors.Driver, testutil.DeclarationFor("pickup", "image/png", image)),
		http.StatusServiceUnavailable, "PROOF_STORAGE_NOT_CONFIGURED")
	devReady := serve(dev, httptest.NewRequest(http.MethodGet, "/health/ready", nil))
	if devReady.Code != http.StatusOK || !strings.Contains(devReady.Body.String(), `"not_configured"`) {
		t.Fatalf("development readiness reports the missing store without failing: status = %d, body = %s", devReady.Code, devReady.Body.String())
	}

	// With storage configured, production readiness proves the bucket.
	lit := testutil.NewProductionHarness(t, secret)
	litReady := serve(lit, httptest.NewRequest(http.MethodGet, "/health/ready", nil))
	if litReady.Code != http.StatusOK || !strings.Contains(litReady.Body.String(), `"proofStorage":{"status":"healthy"}`) {
		t.Fatalf("production readiness with a private bucket: status = %d, body = %s", litReady.Code, litReady.Body.String())
	}
}

// TestProofUploadIssuanceIsBounded: uploads are only issued for a proof the
// custody state can accept, and never without limit.
func TestProofUploadIssuanceIsBounded(t *testing.T) {
	h := testutil.NewHarness(t)
	ctx := context.Background()
	deliveryID, actors := h.SeedDelivery(ctx, testutil.Actor{}, testutil.Actor{}, "")

	// A delivery proof cannot be uploaded before pickup.
	requireCode(t, h.RequestUpload(deliveryID, actors.Driver, testutil.DeclarationFor("delivery", "image/png", testutil.TestImage("image/png", 1))),
		http.StatusConflict, "STATE_CONFLICT")
	// A return proof only exists for a return in progress.
	requireCode(t, h.RequestUpload(deliveryID, actors.Driver, testutil.DeclarationFor("return", "image/png", testutil.TestImage("image/png", 2))),
		http.StatusConflict, "STATE_CONFLICT")

	for i := 0; i < 6; i++ {
		h.MustRequestUpload(deliveryID, actors.Driver, testutil.DeclarationFor("pickup", "image/png", testutil.TestImage("image/png", 10+i)))
	}
	requireCode(t, h.RequestUpload(deliveryID, actors.Driver, testutil.DeclarationFor("pickup", "image/png", testutil.TestImage("image/png", 30))),
		http.StatusTooManyRequests, "PROOF_UPLOAD_LIMIT")
}
