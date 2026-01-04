package testutil

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

// TestServer wraps an httptest.Server with helpers
type TestServer struct {
	Server  *httptest.Server
	Router  chi.Router
	BaseURL string
}

// NewTestServer creates a new test server
func NewTestServer(router chi.Router) *TestServer {
	server := httptest.NewServer(router)
	return &TestServer{
		Server:  server,
		Router:  router,
		BaseURL: server.URL,
	}
}

// Close shuts down the test server
func (ts *TestServer) Close() {
	ts.Server.Close()
}

// TestClient provides HTTP client helpers for tests
type TestClient struct {
	BaseURL    string
	HTTPClient *http.Client
	AuthToken  string
}

// NewTestClient creates a new test client
func NewTestClient(baseURL string) *TestClient {
	return &TestClient{
		BaseURL: baseURL,
		HTTPClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// WithAuth sets the auth token for requests
func (tc *TestClient) WithAuth(token string) *TestClient {
	tc.AuthToken = token
	return tc
}

// Request executes an HTTP request
func (tc *TestClient) Request(ctx context.Context, method, path string, body interface{}) (*http.Response, error) {
	var bodyReader io.Reader
	if body != nil {
		jsonBody, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		bodyReader = bytes.NewReader(jsonBody)
	}

	req, err := http.NewRequestWithContext(ctx, method, tc.BaseURL+path, bodyReader)
	if err != nil {
		return nil, err
	}

	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if tc.AuthToken != "" {
		req.Header.Set("Authorization", "Bearer "+tc.AuthToken)
	}

	return tc.HTTPClient.Do(req)
}

// Get performs a GET request
func (tc *TestClient) Get(ctx context.Context, path string) (*http.Response, error) {
	return tc.Request(ctx, http.MethodGet, path, nil)
}

// Post performs a POST request
func (tc *TestClient) Post(ctx context.Context, path string, body interface{}) (*http.Response, error) {
	return tc.Request(ctx, http.MethodPost, path, body)
}

// Put performs a PUT request
func (tc *TestClient) Put(ctx context.Context, path string, body interface{}) (*http.Response, error) {
	return tc.Request(ctx, http.MethodPut, path, body)
}

// Patch performs a PATCH request
func (tc *TestClient) Patch(ctx context.Context, path string, body interface{}) (*http.Response, error) {
	return tc.Request(ctx, http.MethodPatch, path, body)
}

// Delete performs a DELETE request
func (tc *TestClient) Delete(ctx context.Context, path string) (*http.Response, error) {
	return tc.Request(ctx, http.MethodDelete, path, nil)
}

// ========================================
// Response Helpers
// ========================================

// Response wraps an HTTP response with helpers
type Response struct {
	*http.Response
	Body []byte
}

// ParseResponse reads and wraps an HTTP response
func ParseResponse(t *testing.T, resp *http.Response) *Response {
	t.Helper()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("Failed to read response body: %v", err)
	}
	resp.Body.Close()

	return &Response{
		Response: resp,
		Body:     body,
	}
}

// JSON unmarshals the response body into v
func (r *Response) JSON(v interface{}) error {
	return json.Unmarshal(r.Body, v)
}

// String returns the response body as string
func (r *Response) String() string {
	return string(r.Body)
}

// ========================================
// Request Recorder
// ========================================

// RequestRecorder records HTTP requests for assertions
type RequestRecorder struct {
	Requests []*RecordedRequest
}

// RecordedRequest contains details of a recorded request
type RecordedRequest struct {
	Method  string
	URL     string
	Headers http.Header
	Body    []byte
}

// NewRequestRecorder creates a new request recorder
func NewRequestRecorder() *RequestRecorder {
	return &RequestRecorder{
		Requests: make([]*RecordedRequest, 0),
	}
}

// Handler returns an HTTP handler that records requests
func (rr *RequestRecorder) Handler(statusCode int, responseBody interface{}) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		r.Body.Close()

		rr.Requests = append(rr.Requests, &RecordedRequest{
			Method:  r.Method,
			URL:     r.URL.String(),
			Headers: r.Header,
			Body:    body,
		})

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(statusCode)
		if responseBody != nil {
			json.NewEncoder(w).Encode(responseBody)
		}
	}
}

// LastRequest returns the last recorded request
func (rr *RequestRecorder) LastRequest() *RecordedRequest {
	if len(rr.Requests) == 0 {
		return nil
	}
	return rr.Requests[len(rr.Requests)-1]
}

// Clear clears all recorded requests
func (rr *RequestRecorder) Clear() {
	rr.Requests = rr.Requests[:0]
}

// Count returns the number of recorded requests
func (rr *RequestRecorder) Count() int {
	return len(rr.Requests)
}

// ========================================
// Mock Server
// ========================================

// MockServer provides a configurable mock HTTP server
type MockServer struct {
	Server   *httptest.Server
	Handlers map[string]http.HandlerFunc
	Recorder *RequestRecorder
}

// NewMockServer creates a new mock server
func NewMockServer() *MockServer {
	ms := &MockServer{
		Handlers: make(map[string]http.HandlerFunc),
		Recorder: NewRequestRecorder(),
	}

	router := chi.NewRouter()
	router.HandleFunc("/*", func(w http.ResponseWriter, r *http.Request) {
		key := r.Method + " " + r.URL.Path
		if handler, ok := ms.Handlers[key]; ok {
			handler(w, r)
			return
		}
		// Default handler records and returns 404
		ms.Recorder.Handler(http.StatusNotFound, map[string]string{"error": "not found"})(w, r)
	})

	ms.Server = httptest.NewServer(router)
	return ms
}

// On registers a handler for a specific method and path
func (ms *MockServer) On(method, path string, statusCode int, response interface{}) *MockServer {
	key := method + " " + path
	ms.Handlers[key] = ms.Recorder.Handler(statusCode, response)
	return ms
}

// OnGet registers a GET handler
func (ms *MockServer) OnGet(path string, statusCode int, response interface{}) *MockServer {
	return ms.On(http.MethodGet, path, statusCode, response)
}

// OnPost registers a POST handler
func (ms *MockServer) OnPost(path string, statusCode int, response interface{}) *MockServer {
	return ms.On(http.MethodPost, path, statusCode, response)
}

// OnPut registers a PUT handler
func (ms *MockServer) OnPut(path string, statusCode int, response interface{}) *MockServer {
	return ms.On(http.MethodPut, path, statusCode, response)
}

// OnDelete registers a DELETE handler
func (ms *MockServer) OnDelete(path string, statusCode int, response interface{}) *MockServer {
	return ms.On(http.MethodDelete, path, statusCode, response)
}

// URL returns the server URL
func (ms *MockServer) URL() string {
	return ms.Server.URL
}

// Close shuts down the mock server
func (ms *MockServer) Close() {
	ms.Server.Close()
}

// ========================================
// Assertions
// ========================================

// AssertStatus asserts the response status code
func AssertStatus(t *testing.T, resp *http.Response, expected int) {
	t.Helper()
	if resp.StatusCode != expected {
		t.Errorf("Expected status %d, got %d", expected, resp.StatusCode)
	}
}

// AssertJSON asserts the response body matches expected JSON
func AssertJSON(t *testing.T, resp *Response, expected interface{}) {
	t.Helper()

	expectedBytes, err := json.Marshal(expected)
	if err != nil {
		t.Fatalf("Failed to marshal expected JSON: %v", err)
	}

	// Normalize both JSON strings
	var expectedMap, actualMap interface{}
	json.Unmarshal(expectedBytes, &expectedMap)
	json.Unmarshal(resp.Body, &actualMap)

	expectedNorm, _ := json.Marshal(expectedMap)
	actualNorm, _ := json.Marshal(actualMap)

	if string(expectedNorm) != string(actualNorm) {
		t.Errorf("JSON mismatch:\nExpected: %s\nActual: %s", expectedNorm, actualNorm)
	}
}

// AssertContains asserts the response body contains a substring
func AssertContains(t *testing.T, resp *Response, substring string) {
	t.Helper()
	if !bytes.Contains(resp.Body, []byte(substring)) {
		t.Errorf("Response body does not contain %q:\n%s", substring, resp.String())
	}
}

// AssertHeader asserts a response header value
func AssertHeader(t *testing.T, resp *http.Response, key, expected string) {
	t.Helper()
	actual := resp.Header.Get(key)
	if actual != expected {
		t.Errorf("Header %s: expected %q, got %q", key, expected, actual)
	}
}
