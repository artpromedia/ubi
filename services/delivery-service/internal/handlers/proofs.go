/*
 * Custody proofs as verified objects (P17, recheck R02).
 *
 * A proof used to be whatever object key, size and checksum a driver's app
 * claimed. Now it is an object in the PRIVATE proof bucket that this service
 * issued the upload for and verified before attaching:
 *
 *  1. POST .../custody/proof-uploads — the assigned driver declares the
 *     image (type, content type, size, SHA-256). The service generates the
 *     key itself — proofs/<delivery>/<type>/<driver>/<upload> — records who
 *     it was issued to, and answers a presigned PUT for exactly that key
 *     that expires in minutes (Content-Type and the SHA-256 checksum are
 *     signed headers).
 *  2. The app PUTs the bytes straight to the bucket.
 *  3. POST .../custody/{pickup,delivery}-proof or .../return/complete with
 *     {uploadId} — refused unless the caller is the actor the upload was
 *     issued to, for this delivery and this proof type. The stored object is
 *     re-measured, re-hashed and sniffed (verifyProofObject): a missing
 *     object, a size over the limit or different from the declaration, a
 *     checksum that does not match, or bytes that are not the declared image
 *     type are all refused, the object is deleted and the upload marked
 *     rejected. Only a verified object becomes a delivery_proofs row, in the
 *     same transaction as the custody transition it proves.
 *  4. GET .../custody/proofs/{proofId}/url — the sender, the assigned driver
 *     or ops get a presigned GET that lives seconds. Nobody else, and never a
 *     public URL. A legacy (pre-P17) proof that was never verified gets no
 *     URL at all.
 *
 * With no proof storage configured, steps 1, 3 and 4 answer 503
 * PROOF_STORAGE_NOT_CONFIGURED and production readiness fails (fail closed).
 */

package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/config"
	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/custody"
	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/identity"
	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/proofstore"
)

const (
	// proofAttachWindow bounds how long after issuance an upload may still be
	// attached: a proof is evidence of a moment, not something to hold back.
	proofAttachWindow = 24 * time.Hour
	// maxOpenProofUploads caps issued-but-unattached, unexpired uploads per
	// delivery, so an app (or an attacker holding a driver session) cannot
	// mint unbounded upload URLs.
	maxOpenProofUploads = 6
	// sniffBytes is how much of an object content sniffing reads.
	sniffBytes = 512
)

func errProofStorageNotConfigured() *custodyError {
	return &custodyError{http.StatusServiceUnavailable, "PROOF_STORAGE_NOT_CONFIGURED",
		"Proof object storage is not configured: custody proofs cannot be uploaded, verified or viewed"}
}

func errProofStorageUnavailable() *custodyError {
	return &custodyError{http.StatusServiceUnavailable, "PROOF_STORAGE_UNAVAILABLE",
		"Proof object storage is unavailable right now; nothing was recorded. Retry shortly."}
}

// proofTypeAcceptsState reports whether a proof of this type can be posted
// from the current custody state — the same states the attach endpoints
// transition from, so an upload is never issued for a proof that could not
// be attached.
func proofTypeAcceptsState(proofType, state string) bool {
	switch proofType {
	case custody.ProofPickup:
		return state == custody.CourierAssigned
	case custody.ProofDelivery:
		switch state {
		case custody.InTransit, custody.DeliveryAttempted, custody.DeliveryRetry, custody.RecipientUnreachable:
			return true
		}
	case custody.ProofReturn:
		return state == custody.Returning
	}
	return false
}

type proofUploadRequest struct {
	Type        string `json:"type"`
	ContentType string `json:"contentType"`
	SizeBytes   int64  `json:"sizeBytes"`
	SHA256      string `json:"sha256"`
}

type proofUploadResponse struct {
	UploadID    string            `json:"uploadId"`
	Type        string            `json:"type"`
	ObjectKey   string            `json:"objectKey"`
	ContentType string            `json:"contentType"`
	SizeBytes   int64             `json:"sizeBytes"`
	SHA256      string            `json:"sha256"`
	ExpiresAt   time.Time         `json:"expiresAt"`
	Replay      bool              `json:"replay"`
	Upload      proofUploadTarget `json:"upload"`
}

type proofUploadTarget struct {
	Method  string            `json:"method"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
}

func flattenHeaders(headers http.Header) map[string]string {
	out := make(map[string]string, len(headers))
	for name, values := range headers {
		if len(values) > 0 {
			out[name] = values[0]
		}
	}
	return out
}

// PostProofUpload handles POST /api/v1/deliveries/{id}/custody/proof-uploads.
// Assigned driver only. Issues a short-lived, scope-bound presigned PUT for a
// server-generated key. Idempotent on (delivery, type, driver, sha256): asking
// again for the same image while its upload is still open re-signs the SAME
// key (200, replay) instead of minting a second slot.
func (h *Handler) PostProofUpload(w http.ResponseWriter, r *http.Request) {
	deliveryID := chi.URLParam(r, "id")
	actor, ok := identity.ActorFrom(r.Context())
	if !ok {
		writeCustodyError(w, errNotFound())
		return
	}
	if actor.Role != identity.RoleDriver {
		writeCustodyError(w, errForbidden("only the assigned driver may upload a custody proof"))
		return
	}
	cst, cerr := h.loadCustodyForActor(r.Context(), deliveryID, actor)
	if cerr != nil {
		writeCustodyError(w, cerr)
		return
	}
	if !cst.isAssignedDriver(actor) {
		writeCustodyError(w, errNotFound())
		return
	}
	if !h.proofs.Configured() {
		writeCustodyError(w, errProofStorageNotConfigured())
		return
	}

	var req proofUploadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeCustodyError(w, errValidation("invalid request body"))
		return
	}
	sha := strings.ToLower(strings.TrimSpace(req.SHA256))
	if problems := custody.ValidateProofUpload(custody.ProofUploadInput{
		Type: req.Type, ContentType: req.ContentType, SizeBytes: req.SizeBytes, SHA256: sha,
	}); len(problems) > 0 {
		respondError(w, http.StatusBadRequest, "VALIDATION_ERROR", strings.Join(problems, "; "))
		return
	}
	if !proofTypeAcceptsState(req.Type, cst.State) {
		writeCustodyError(w, errConflict("a "+req.Type+" proof cannot be uploaded from custody state "+cst.State))
		return
	}

	ttl := h.cfg.ProofStorage.UploadTTL
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}
	ctx := r.Context()

	// Replay: the same image, still open — re-sign the same key.
	var existingID, existingKey string
	err := h.db.Pool.QueryRow(ctx, `
		SELECT id::text, object_key FROM delivery_proof_uploads
		WHERE delivery_id = $1 AND type = $2 AND issued_to = $3 AND sha256 = $4
			AND content_type = $5 AND size_bytes = $6
			AND status = 'issued' AND created_at > now() - make_interval(secs => $7)
		ORDER BY created_at DESC LIMIT 1
	`, deliveryID, req.Type, actor.UserID.String(), sha, req.ContentType, req.SizeBytes, proofAttachWindow.Seconds()).Scan(&existingID, &existingKey)
	replay := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		writeCustodyError(w, err)
		return
	}

	uploadID, objectKey := existingID, existingKey
	if !replay {
		var open int
		if err := h.db.Pool.QueryRow(ctx, `
			SELECT count(*) FROM delivery_proof_uploads
			WHERE delivery_id = $1 AND status = 'issued' AND expires_at > now()
		`, deliveryID).Scan(&open); err != nil {
			writeCustodyError(w, err)
			return
		}
		if open >= maxOpenProofUploads {
			respondError(w, http.StatusTooManyRequests, "PROOF_UPLOAD_LIMIT",
				"Too many open proof uploads for this delivery; finish or let the open ones expire first")
			return
		}
		uploadID = uuid.New().String()
		objectKey = custody.ProofObjectKey(deliveryID, req.Type, actor.UserID.String(), uploadID)
	}

	signed, headers, err := h.proofs.PresignPut(ctx, objectKey, req.ContentType, sha, ttl)
	if err != nil {
		log.Error().Err(err).Str("deliveryId", deliveryID).Msg("failed to presign a proof upload")
		writeCustodyError(w, errProofStorageUnavailable())
		return
	}
	expiresAt := time.Now().UTC().Add(ttl)

	if replay {
		if _, err := h.db.Pool.Exec(ctx, `UPDATE delivery_proof_uploads SET expires_at = $2, updated_at = now() WHERE id = $1`,
			uploadID, expiresAt); err != nil {
			writeCustodyError(w, err)
			return
		}
	} else {
		if _, err := h.db.Pool.Exec(ctx, `
			INSERT INTO delivery_proof_uploads (
				id, delivery_id, custody_id, type, object_key, content_type, size_bytes, sha256,
				issued_to, issued_role, status, expires_at, created_at, updated_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'issued', $11, now(), now())
		`, uploadID, deliveryID, cst.ID, req.Type, objectKey, req.ContentType, req.SizeBytes, sha,
			actor.UserID.String(), actor.Role, expiresAt); err != nil {
			writeCustodyError(w, err)
			return
		}
	}

	status := http.StatusCreated
	if replay {
		status = http.StatusOK
	}
	w.Header().Set("Cache-Control", "no-store")
	respond(w, status, proofUploadResponse{
		UploadID: uploadID, Type: req.Type, ObjectKey: objectKey,
		ContentType: req.ContentType, SizeBytes: req.SizeBytes, SHA256: sha,
		ExpiresAt: expiresAt, Replay: replay,
		Upload: proofUploadTarget{Method: http.MethodPut, URL: signed.String(), Headers: flattenHeaders(headers)},
	})
}

// proofUpload is one delivery_proof_uploads row.
type proofUpload struct {
	ID           string
	DeliveryID   string
	Type         string
	ObjectKey    string
	ContentType  string
	SizeBytes    int64
	SHA256       string
	IssuedTo     string
	Status       string
	RejectReason string
	CreatedAt    time.Time
}

// proofRejection is a definite verdict on an uploaded object's bytes.
type proofRejection struct {
	reason string // stored as delivery_proof_uploads.reject_reason
	code   string
	detail string
}

func (p *proofRejection) Error() string { return p.detail }

var errProofObjectMissing = errors.New("the proof object has not been uploaded")

// verifyProofObject checks the stored object against the upload's
// declaration: present, within the size limit, exactly the declared size,
// SHA-256 of the stored bytes equal to the declared checksum, and sniffed as
// the declared image type. Returns nil when the object verifies, a
// *proofRejection for a definite mismatch, errProofObjectMissing when there is
// no object yet, and any other error when the store could not be read.
func (h *Handler) verifyProofObject(ctx context.Context, upload *proofUpload) error {
	info, err := h.proofs.Stat(ctx, upload.ObjectKey)
	if errors.Is(err, proofstore.ErrNotFound) {
		return errProofObjectMissing
	}
	if err != nil {
		return err
	}
	if info.Size > custody.MaxProofSizeBytes {
		return &proofRejection{"object_too_large", "PROOF_OBJECT_TOO_LARGE", "the uploaded object is larger than a proof may be"}
	}
	if info.Size != upload.SizeBytes {
		return &proofRejection{"size_mismatch", "PROOF_SIZE_MISMATCH", "the uploaded object's size does not match what was declared"}
	}

	body, err := h.proofs.Open(ctx, upload.ObjectKey)
	if errors.Is(err, proofstore.ErrNotFound) {
		return errProofObjectMissing
	}
	if err != nil {
		return err
	}
	defer func() { _ = body.Close() }()

	hasher := sha256.New()
	head := make([]byte, sniffBytes)
	n, err := io.ReadFull(body, head)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return err
	}
	head = head[:n]
	hasher.Write(head)
	rest, err := io.Copy(hasher, io.LimitReader(body, custody.MaxProofSizeBytes+1-int64(n)))
	if err != nil {
		return err
	}
	total := int64(n) + rest
	if total > custody.MaxProofSizeBytes {
		return &proofRejection{"object_too_large", "PROOF_OBJECT_TOO_LARGE", "the uploaded object is larger than a proof may be"}
	}
	if total != upload.SizeBytes {
		return &proofRejection{"size_mismatch", "PROOF_SIZE_MISMATCH", "the uploaded object's size does not match what was declared"}
	}
	if hex.EncodeToString(hasher.Sum(nil)) != upload.SHA256 {
		return &proofRejection{"checksum_mismatch", "PROOF_CHECKSUM_MISMATCH", "the uploaded object's SHA-256 does not match the declared checksum"}
	}
	if sniffed := custody.SniffProofContentType(head); sniffed != upload.ContentType {
		return &proofRejection{"content_type_mismatch", "PROOF_CONTENT_TYPE_MISMATCH", "the uploaded object is not a " + upload.ContentType + " image"}
	}
	return nil
}

// rejectUpload marks an issued upload rejected and deletes its object, so
// bytes that failed verification never linger in the proof bucket.
func (h *Handler) rejectUpload(ctx context.Context, upload *proofUpload, reason string) {
	if _, err := h.db.Pool.Exec(ctx, `
		UPDATE delivery_proof_uploads SET status = 'rejected', reject_reason = $2, updated_at = now()
		WHERE id = $1 AND status = 'issued'
	`, upload.ID, reason); err != nil {
		log.Error().Err(err).Str("uploadId", upload.ID).Msg("failed to mark a proof upload rejected")
	}
	if err := h.proofs.Remove(ctx, upload.ObjectKey); err != nil {
		log.Error().Err(err).Str("uploadId", upload.ID).Msg("failed to delete a rejected proof object")
	}
}

type proofAttachRequest struct {
	UploadID string `json:"uploadId"`
	// ObjectKey is read only to refuse the pre-P17 shape explicitly.
	ObjectKey string `json:"objectKey"`
}

func decodeAttach(r *http.Request) (string, *custodyError) {
	var req proofAttachRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return "", errValidation("invalid request body")
	}
	if strings.TrimSpace(req.UploadID) == "" {
		if req.ObjectKey != "" {
			return "", &custodyError{http.StatusBadRequest, "PROOF_UPLOAD_REQUIRED",
				"client-supplied object keys are not accepted: request an upload (POST .../custody/proof-uploads), PUT the image, then attach it by uploadId"}
		}
		return "", errValidation("uploadId is required")
	}
	return strings.TrimSpace(req.UploadID), nil
}

type attachOutcome struct {
	ProofID string
	Replay  bool
}

// attachVerifiedProof is the one attach path (pickup, delivery and return
// proofs): ownership and scope checks, object verification, then the proof
// row, the upload's attachment and the custody chain — plus extraSide — in
// one transaction.
func (h *Handler) attachVerifiedProof(
	ctx context.Context, cst *custodyRecord, actor identity.Actor, proofType, uploadID string,
	chainFor func(current string) []string, extraSide func(ctx context.Context, tx pgx.Tx) error,
) (*attachOutcome, error) {
	if !h.proofs.Configured() {
		return nil, errProofStorageNotConfigured()
	}
	if _, err := uuid.Parse(uploadID); err != nil {
		return nil, &custodyError{http.StatusNotFound, "PROOF_UPLOAD_NOT_FOUND", "no such proof upload for this delivery"}
	}

	var upload proofUpload
	err := h.db.Pool.QueryRow(ctx, `
		SELECT id::text, delivery_id::text, type, object_key, content_type, size_bytes, sha256,
			issued_to::text, status, COALESCE(reject_reason, ''), created_at
		FROM delivery_proof_uploads WHERE id = $1 AND delivery_id = $2
	`, uploadID, cst.DeliveryID).Scan(&upload.ID, &upload.DeliveryID, &upload.Type, &upload.ObjectKey, &upload.ContentType,
		&upload.SizeBytes, &upload.SHA256, &upload.IssuedTo, &upload.Status, &upload.RejectReason, &upload.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &custodyError{http.StatusNotFound, "PROOF_UPLOAD_NOT_FOUND", "no such proof upload for this delivery"}
	}
	if err != nil {
		return nil, err
	}

	// Object ownership: only the custody actor the upload was issued to may
	// attach it, only as the proof type it was issued for, and only if its
	// key still sits in that actor's namespace for this delivery.
	if upload.IssuedTo != actor.UserID.String() {
		return nil, &custodyError{http.StatusForbidden, "PROOF_UPLOAD_NOT_YOURS",
			"this proof upload was issued to a different custody actor; only that actor may attach it"}
	}
	if upload.Type != proofType {
		return nil, &custodyError{http.StatusConflict, "PROOF_UPLOAD_TYPE_MISMATCH",
			"this upload was issued for a " + upload.Type + " proof, not a " + proofType + " proof"}
	}
	if !strings.HasPrefix(upload.ObjectKey, custody.ProofObjectKeyPrefix(cst.DeliveryID, proofType, actor.UserID.String())) {
		return nil, &custodyError{http.StatusConflict, "PROOF_UPLOAD_NOT_YOURS", "this upload's object is outside the actor's proof namespace"}
	}

	switch upload.Status {
	case "attached":
		var proofID string
		if err := h.db.Pool.QueryRow(ctx, `SELECT id::text FROM delivery_proofs WHERE upload_id = $1`, upload.ID).Scan(&proofID); err != nil {
			return nil, err
		}
		return &attachOutcome{ProofID: proofID, Replay: true}, nil
	case "rejected":
		return nil, &custodyError{http.StatusConflict, "PROOF_UPLOAD_REJECTED",
			"this upload was rejected (" + upload.RejectReason + "); request a new upload"}
	}
	if time.Since(upload.CreatedAt) > proofAttachWindow {
		h.rejectUpload(ctx, &upload, "attach_window_expired")
		return nil, &custodyError{http.StatusConflict, "PROOF_UPLOAD_EXPIRED", "this upload is too old to attach; request a new upload"}
	}

	// The identical image is already this delivery's proof of this type
	// (another upload of the same bytes): answer that proof, keep one copy.
	var duplicateID string
	err = h.db.Pool.QueryRow(ctx, `SELECT id::text FROM delivery_proofs WHERE delivery_id = $1 AND type = $2 AND sha256 = $3`,
		cst.DeliveryID, proofType, upload.SHA256).Scan(&duplicateID)
	if err == nil {
		h.rejectUpload(ctx, &upload, "duplicate_of_attached_proof")
		return &attachOutcome{ProofID: duplicateID, Replay: true}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	chain := chainFor(cst.State)
	if chain == nil {
		return nil, errConflict("a " + proofType + " proof cannot be posted from custody state " + cst.State)
	}

	if err := h.verifyProofObject(ctx, &upload); err != nil {
		var rejection *proofRejection
		switch {
		case errors.As(err, &rejection):
			h.rejectUpload(ctx, &upload, rejection.reason)
			return nil, &custodyError{http.StatusUnprocessableEntity, rejection.code, rejection.detail + "; the upload was rejected and its object deleted"}
		case errors.Is(err, errProofObjectMissing):
			return nil, &custodyError{http.StatusConflict, "PROOF_OBJECT_MISSING",
				"nothing has been uploaded for this proof yet; PUT the image to the upload URL (or request a new upload if it expired), then attach again"}
		default:
			log.Error().Err(err).Str("uploadId", upload.ID).Msg("proof object verification could not read the store")
			return nil, errProofStorageUnavailable()
		}
	}

	var proofID string
	err = h.applyChain(ctx, cst, chain, custody.ActorDriver, &actor.UserID, proofType+"_proof_recorded",
		func(ctx context.Context, tx pgx.Tx) error {
			tag, err := tx.Exec(ctx, `
				UPDATE delivery_proof_uploads SET status = 'attached', attached_at = now(), updated_at = now()
				WHERE id = $1 AND status = 'issued'
			`, upload.ID)
			if err != nil {
				return err
			}
			if tag.RowsAffected() != 1 {
				return errConflict("this upload was attached or rejected concurrently; re-fetch the timeline")
			}
			if err := tx.QueryRow(ctx, `
				INSERT INTO delivery_proofs (
					delivery_id, custody_id, type, object_key, content_type, size_bytes, sha256,
					uploaded_by, uploaded_role, upload_id, verified_at, created_at
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now())
				RETURNING id::text
			`, cst.DeliveryID, cst.ID, proofType, upload.ObjectKey, upload.ContentType, upload.SizeBytes, upload.SHA256,
				actor.UserID.String(), actor.Role, upload.ID).Scan(&proofID); err != nil {
				return err
			}
			if extraSide != nil {
				return extraSide(ctx, tx)
			}
			return nil
		})
	if err != nil {
		return nil, err
	}
	return &attachOutcome{ProofID: proofID}, nil
}

// postProof is the shared handler body for pickup-proof and delivery-proof.
func (h *Handler) postProof(w http.ResponseWriter, r *http.Request, proofType string, chainFor func(current string) []string) {
	deliveryID := chi.URLParam(r, "id")
	actor, ok := identity.ActorFrom(r.Context())
	if !ok {
		writeCustodyError(w, errNotFound())
		return
	}
	if actor.Role != identity.RoleDriver {
		writeCustodyError(w, errForbidden("only the assigned driver may post a "+proofType+" proof"))
		return
	}
	cst, cerr := h.loadCustodyForActor(r.Context(), deliveryID, actor)
	if cerr != nil {
		writeCustodyError(w, cerr)
		return
	}
	if !cst.isAssignedDriver(actor) {
		writeCustodyError(w, errNotFound())
		return
	}
	uploadID, derr := decodeAttach(r)
	if derr != nil {
		writeCustodyError(w, derr)
		return
	}

	outcome, err := h.attachVerifiedProof(r.Context(), cst, actor, proofType, uploadID, chainFor, nil)
	if err != nil {
		writeCustodyError(w, err)
		return
	}
	status := http.StatusCreated
	if outcome.Replay {
		status = http.StatusOK
		if current, err := h.loadCustodyForActor(r.Context(), deliveryID, actor); err == nil {
			cst = current
		}
	}
	respond(w, status, map[string]interface{}{
		"proofId": outcome.ProofID, "deliveryId": deliveryID, "type": proofType,
		"replay": outcome.Replay, "custodyState": cst.State, "verified": true,
	})
}

// PostPickupProof handles POST /api/v1/deliveries/{id}/custody/pickup-proof.
// Driver only, with a verified upload. courier_assigned -> picked_up ->
// in_transit (a pickup starts transit immediately; there is no separate
// "start transit" action).
func (h *Handler) PostPickupProof(w http.ResponseWriter, r *http.Request) {
	h.postProof(w, r, custody.ProofPickup, func(current string) []string {
		if current == custody.CourierAssigned {
			return []string{custody.CourierAssigned, custody.PickedUp, custody.InTransit}
		}
		return nil
	})
}

// PostDeliveryProof handles POST /api/v1/deliveries/{id}/custody/delivery-proof.
// Driver only, with a verified upload. Reaches `delivered` from in_transit,
// delivery_attempted, delivery_retry directly, or from recipient_unreachable
// by chaining through delivery_retry (a successful retry IS a delivery proof;
// there is no separate "start retry" action).
func (h *Handler) PostDeliveryProof(w http.ResponseWriter, r *http.Request) {
	h.postProof(w, r, custody.ProofDelivery, func(current string) []string {
		switch current {
		case custody.InTransit, custody.DeliveryAttempted, custody.DeliveryRetry:
			return []string{current, custody.Delivered}
		case custody.RecipientUnreachable:
			return []string{custody.RecipientUnreachable, custody.DeliveryRetry, custody.Delivered}
		default:
			return nil
		}
	})
}

// GetProofURL handles GET /api/v1/deliveries/{id}/custody/proofs/{proofId}/url.
// The sender, the assigned driver or ops only (anyone else: 404). Answers a
// presigned GET that lives seconds (config.ProofStorage.DownloadTTL, capped at
// config.MaxProofDownloadTTL); the bucket itself is private, so this URL is
// the only way to the bytes. A proof that was never verified (pre-P17) gets
// no URL.
func (h *Handler) GetProofURL(w http.ResponseWriter, r *http.Request) {
	deliveryID := chi.URLParam(r, "id")
	proofID := chi.URLParam(r, "proofId")
	actor, ok := identity.ActorFrom(r.Context())
	if !ok {
		writeCustodyError(w, errNotFound())
		return
	}
	cst, cerr := h.loadCustodyForActor(r.Context(), deliveryID, actor)
	if cerr != nil {
		writeCustodyError(w, cerr)
		return
	}
	if !h.proofs.Configured() {
		writeCustodyError(w, errProofStorageNotConfigured())
		return
	}
	if _, err := uuid.Parse(proofID); err != nil {
		writeCustodyError(w, errNotFound())
		return
	}

	var objectKey, proofType, contentType string
	var verified bool
	err := h.db.Pool.QueryRow(r.Context(), `
		SELECT object_key, type, content_type, (upload_id IS NOT NULL AND verified_at IS NOT NULL)
		FROM delivery_proofs WHERE id = $1 AND custody_id = $2
	`, proofID, cst.ID).Scan(&objectKey, &proofType, &contentType, &verified)
	if errors.Is(err, pgx.ErrNoRows) {
		writeCustodyError(w, errNotFound())
		return
	}
	if err != nil {
		writeCustodyError(w, err)
		return
	}
	if !verified {
		writeCustodyError(w, &custodyError{http.StatusConflict, "PROOF_NOT_VERIFIED",
			"this proof predates verified proof storage; its object was never verified and cannot be served"})
		return
	}

	ttl := h.cfg.ProofStorage.DownloadTTL
	if ttl <= 0 || ttl > config.MaxProofDownloadTTL {
		ttl = config.MaxProofDownloadTTL
	}
	signed, err := h.proofs.PresignGet(r.Context(), objectKey, ttl)
	if err != nil {
		log.Error().Err(err).Str("proofId", proofID).Msg("failed to presign a proof download")
		writeCustodyError(w, errProofStorageUnavailable())
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	respond(w, http.StatusOK, map[string]interface{}{
		"proofId": proofID, "type": proofType, "contentType": contentType,
		"url": signed.String(), "expiresAt": time.Now().UTC().Add(ttl),
	})
}
