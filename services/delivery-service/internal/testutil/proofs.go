package testutil

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"time"
)

// TestImage renders a real, decodable image — PNG or JPEG, as a phone would
// upload — whose bytes differ per seed, so every proof in a test has its own
// checksum.
func TestImage(contentType string, seed int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, 24, 24))
	for x := 0; x < 24; x++ {
		for y := 0; y < 24; y++ {
			img.Set(x, y, color.RGBA{R: uint8(seed * 37), G: uint8(x * 10), B: uint8(y*10 + seed), A: 255})
		}
	}
	var buf bytes.Buffer
	var err error
	if contentType == "image/jpeg" {
		err = jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90})
	} else {
		err = png.Encode(&buf, img)
	}
	if err != nil {
		panic(err)
	}
	return buf.Bytes()
}

// SHA256Hex is the lowercase hex SHA-256 of b.
func SHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// UploadGrant is the decoded answer of POST .../custody/proof-uploads.
type UploadGrant struct {
	UploadID  string    `json:"uploadId"`
	ObjectKey string    `json:"objectKey"`
	ExpiresAt time.Time `json:"expiresAt"`
	Replay    bool      `json:"replay"`
	Upload    struct {
		Method  string            `json:"method"`
		URL     string            `json:"url"`
		Headers map[string]string `json:"headers"`
	} `json:"upload"`
}

// ProofDeclaration is what a driver declares for an upload slot.
type ProofDeclaration struct {
	Type        string `json:"type"`
	ContentType string `json:"contentType"`
	SizeBytes   int64  `json:"sizeBytes"`
	SHA256      string `json:"sha256"`
}

// DeclarationFor declares exactly these bytes.
func DeclarationFor(proofType, contentType string, content []byte) ProofDeclaration {
	return ProofDeclaration{Type: proofType, ContentType: contentType, SizeBytes: int64(len(content)), SHA256: SHA256Hex(content)}
}

func jsonRequest(method, path string, body interface{}) *http.Request {
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(method, path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	return req
}

// RequestUpload asks for an upload slot; the recorder is returned as is.
func (h *Harness) RequestUpload(deliveryID string, actor Actor, decl ProofDeclaration) *httptest.ResponseRecorder {
	h.T.Helper()
	return h.Do(jsonRequest(http.MethodPost, "/api/v1/deliveries/"+deliveryID+"/custody/proof-uploads", decl), actor)
}

// MustRequestUpload asks for an upload slot and fails the test unless it is
// granted.
func (h *Harness) MustRequestUpload(deliveryID string, actor Actor, decl ProofDeclaration) UploadGrant {
	h.T.Helper()
	rec := h.RequestUpload(deliveryID, actor, decl)
	if rec.Code != http.StatusCreated && rec.Code != http.StatusOK {
		h.T.Fatalf("proof-uploads: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var envelope struct {
		Data UploadGrant `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		h.T.Fatalf("proof-uploads answer is not JSON: %v", err)
	}
	return envelope.Data
}

// PutToUpload sends body to a grant's presigned PUT over real HTTP, with the
// signed headers, and returns the storage server's status and body.
func (h *Harness) PutToUpload(grant UploadGrant, body []byte) (int, string) {
	h.T.Helper()
	req, err := http.NewRequest(http.MethodPut, grant.Upload.URL, bytes.NewReader(body))
	if err != nil {
		h.T.Fatalf("build presigned PUT: %v", err)
	}
	for name, value := range grant.Upload.Headers {
		req.Header.Set(name, value)
	}
	req.ContentLength = int64(len(body))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		h.T.Fatalf("presigned PUT: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(raw)
}

// UploadProof requests a slot for content, PUTs it, and returns the upload id.
func (h *Harness) UploadProof(deliveryID string, driver Actor, proofType string, content []byte) string {
	h.T.Helper()
	contentType := "image/png"
	if len(content) > 2 && content[0] == 0xFF && content[1] == 0xD8 {
		contentType = "image/jpeg"
	}
	grant := h.MustRequestUpload(deliveryID, driver, DeclarationFor(proofType, contentType, content))
	if status, body := h.PutToUpload(grant, content); status != http.StatusOK {
		h.T.Fatalf("presigned PUT to %s: status = %d, body = %s", h.S3.Backend, status, body)
	}
	return grant.UploadID
}

// AttachProof posts {uploadId} to a custody proof endpoint suffix
// ("/pickup-proof", "/delivery-proof", "/return/complete").
func (h *Harness) AttachProof(deliveryID, suffix string, actor Actor, uploadID string) *httptest.ResponseRecorder {
	h.T.Helper()
	return h.Do(jsonRequest(http.MethodPost, "/api/v1/deliveries/"+deliveryID+"/custody"+suffix,
		map[string]string{"uploadId": uploadID}), actor)
}

// ProveStep uploads a fresh image and attaches it, failing the test unless
// the attachment is accepted. It returns the attach recorder.
func (h *Harness) ProveStep(deliveryID string, driver Actor, proofType, suffix string, seed int) *httptest.ResponseRecorder {
	h.T.Helper()
	uploadID := h.UploadProof(deliveryID, driver, proofType, TestImage("image/png", seed))
	rec := h.AttachProof(deliveryID, suffix, driver, uploadID)
	if rec.Code != http.StatusCreated && rec.Code != http.StatusOK && rec.Code != http.StatusAccepted {
		h.T.Fatalf("attach %s proof: status = %d, body = %s", proofType, rec.Code, rec.Body.String())
	}
	return rec
}

// FetchURL GETs a URL over real HTTP (a presigned download, or an unsigned
// object URL) and returns status and body.
func FetchURL(rawURL string) (int, []byte, error) {
	resp, err := http.Get(rawURL) //nolint:gosec,noctx // test helper fetching a URL the test itself was handed
	if err != nil {
		return 0, nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	return resp.StatusCode, body, err
}

// UnsignedObjectURL is the plain path-style URL of an object in the harness
// bucket, with no signature — what "public access" would look like.
func (h *Harness) UnsignedObjectURL(key string) string {
	return strings.TrimRight(h.S3.Config.Endpoint, "/") + "/" + h.S3.Config.Bucket + "/" + key
}
