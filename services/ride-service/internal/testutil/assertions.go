package testutil

import (
	"context"
	"reflect"
	"strings"
	"testing"
	"time"
)

// ========================================
// Custom Assertions
// ========================================

// Assert provides fluent assertions
type Assert struct {
	t *testing.T
}

// NewAssert creates a new Assert instance
func NewAssert(t *testing.T) *Assert {
	return &Assert{t: t}
}

// Equal asserts that actual equals expected
func (a *Assert) Equal(expected, actual interface{}, msgAndArgs ...interface{}) {
	a.t.Helper()
	if !reflect.DeepEqual(expected, actual) {
		msg := formatMessage(msgAndArgs...)
		a.t.Errorf("Not equal%s:\nExpected: %v\nActual: %v", msg, expected, actual)
	}
}

// NotEqual asserts that actual does not equal expected
func (a *Assert) NotEqual(expected, actual interface{}, msgAndArgs ...interface{}) {
	a.t.Helper()
	if reflect.DeepEqual(expected, actual) {
		msg := formatMessage(msgAndArgs...)
		a.t.Errorf("Should not be equal%s: %v", msg, actual)
	}
}

// Nil asserts that the value is nil
func (a *Assert) Nil(value interface{}, msgAndArgs ...interface{}) {
	a.t.Helper()
	if value != nil && !reflect.ValueOf(value).IsNil() {
		msg := formatMessage(msgAndArgs...)
		a.t.Errorf("Expected nil%s, got: %v", msg, value)
	}
}

// NotNil asserts that the value is not nil
func (a *Assert) NotNil(value interface{}, msgAndArgs ...interface{}) {
	a.t.Helper()
	if value == nil || reflect.ValueOf(value).IsNil() {
		msg := formatMessage(msgAndArgs...)
		a.t.Errorf("Expected not nil%s", msg)
	}
}

// True asserts that the value is true
func (a *Assert) True(value bool, msgAndArgs ...interface{}) {
	a.t.Helper()
	if !value {
		msg := formatMessage(msgAndArgs...)
		a.t.Errorf("Expected true%s", msg)
	}
}

// False asserts that the value is false
func (a *Assert) False(value bool, msgAndArgs ...interface{}) {
	a.t.Helper()
	if value {
		msg := formatMessage(msgAndArgs...)
		a.t.Errorf("Expected false%s", msg)
	}
}

// NoError asserts that err is nil
func (a *Assert) NoError(err error, msgAndArgs ...interface{}) {
	a.t.Helper()
	if err != nil {
		msg := formatMessage(msgAndArgs...)
		a.t.Errorf("Unexpected error%s: %v", msg, err)
	}
}

// Error asserts that err is not nil
func (a *Assert) Error(err error, msgAndArgs ...interface{}) {
	a.t.Helper()
	if err == nil {
		msg := formatMessage(msgAndArgs...)
		a.t.Errorf("Expected error%s", msg)
	}
}

// ErrorContains asserts that err contains the expected substring
func (a *Assert) ErrorContains(err error, contains string, msgAndArgs ...interface{}) {
	a.t.Helper()
	if err == nil {
		msg := formatMessage(msgAndArgs...)
		a.t.Errorf("Expected error containing %q%s, got nil", contains, msg)
		return
	}
	if !strings.Contains(err.Error(), contains) {
		msg := formatMessage(msgAndArgs...)
		a.t.Errorf("Error %q does not contain %q%s", err.Error(), contains, msg)
	}
}

// Contains asserts that the container contains the element
func (a *Assert) Contains(container, element interface{}, msgAndArgs ...interface{}) {
	a.t.Helper()

	containerValue := reflect.ValueOf(container)
	switch containerValue.Kind() {
	case reflect.String:
		if !strings.Contains(containerValue.String(), reflect.ValueOf(element).String()) {
			msg := formatMessage(msgAndArgs...)
			a.t.Errorf("String %q does not contain %q%s", container, element, msg)
		}
	case reflect.Slice, reflect.Array:
		found := false
		for i := 0; i < containerValue.Len(); i++ {
			if reflect.DeepEqual(containerValue.Index(i).Interface(), element) {
				found = true
				break
			}
		}
		if !found {
			msg := formatMessage(msgAndArgs...)
			a.t.Errorf("Slice does not contain %v%s", element, msg)
		}
	case reflect.Map:
		elementValue := reflect.ValueOf(element)
		if !containerValue.MapIndex(elementValue).IsValid() {
			msg := formatMessage(msgAndArgs...)
			a.t.Errorf("Map does not contain key %v%s", element, msg)
		}
	default:
		a.t.Errorf("Contains not supported for type %T", container)
	}
}

// Len asserts that the container has the expected length
func (a *Assert) Len(container interface{}, expected int, msgAndArgs ...interface{}) {
	a.t.Helper()

	containerValue := reflect.ValueOf(container)
	var length int
	switch containerValue.Kind() {
	case reflect.String, reflect.Slice, reflect.Array, reflect.Map, reflect.Chan:
		length = containerValue.Len()
	default:
		a.t.Errorf("Len not supported for type %T", container)
		return
	}

	if length != expected {
		msg := formatMessage(msgAndArgs...)
		a.t.Errorf("Expected length %d%s, got %d", expected, msg, length)
	}
}

// Empty asserts that the container is empty
func (a *Assert) Empty(container interface{}, msgAndArgs ...interface{}) {
	a.t.Helper()
	a.Len(container, 0, msgAndArgs...)
}

// NotEmpty asserts that the container is not empty
func (a *Assert) NotEmpty(container interface{}, msgAndArgs ...interface{}) {
	a.t.Helper()

	containerValue := reflect.ValueOf(container)
	var length int
	switch containerValue.Kind() {
	case reflect.String, reflect.Slice, reflect.Array, reflect.Map, reflect.Chan:
		length = containerValue.Len()
	default:
		a.t.Errorf("NotEmpty not supported for type %T", container)
		return
	}

	if length == 0 {
		msg := formatMessage(msgAndArgs...)
		a.t.Errorf("Expected not empty%s", msg)
	}
}

// Greater asserts that actual > expected
func (a *Assert) Greater(actual, expected interface{}, msgAndArgs ...interface{}) {
	a.t.Helper()
	if !isGreater(actual, expected) {
		msg := formatMessage(msgAndArgs...)
		a.t.Errorf("Expected %v to be greater than %v%s", actual, expected, msg)
	}
}

// GreaterOrEqual asserts that actual >= expected
func (a *Assert) GreaterOrEqual(actual, expected interface{}, msgAndArgs ...interface{}) {
	a.t.Helper()
	if !isGreaterOrEqual(actual, expected) {
		msg := formatMessage(msgAndArgs...)
		a.t.Errorf("Expected %v to be greater than or equal to %v%s", actual, expected, msg)
	}
}

// Less asserts that actual < expected
func (a *Assert) Less(actual, expected interface{}, msgAndArgs ...interface{}) {
	a.t.Helper()
	if !isLess(actual, expected) {
		msg := formatMessage(msgAndArgs...)
		a.t.Errorf("Expected %v to be less than %v%s", actual, expected, msg)
	}
}

// LessOrEqual asserts that actual <= expected
func (a *Assert) LessOrEqual(actual, expected interface{}, msgAndArgs ...interface{}) {
	a.t.Helper()
	if !isLessOrEqual(actual, expected) {
		msg := formatMessage(msgAndArgs...)
		a.t.Errorf("Expected %v to be less than or equal to %v%s", actual, expected, msg)
	}
}

// InDelta asserts that actual is within delta of expected
func (a *Assert) InDelta(expected, actual, delta float64, msgAndArgs ...interface{}) {
	a.t.Helper()
	diff := expected - actual
	if diff < 0 {
		diff = -diff
	}
	if diff > delta {
		msg := formatMessage(msgAndArgs...)
		a.t.Errorf("Expected %v to be within %v of %v%s (actual diff: %v)", actual, delta, expected, msg, diff)
	}
}

// Eventually asserts that a condition becomes true within a timeout
func (a *Assert) Eventually(condition func() bool, timeout, interval time.Duration, msgAndArgs ...interface{}) {
	a.t.Helper()

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(interval)
	}

	msg := formatMessage(msgAndArgs...)
	a.t.Errorf("Condition not met within %v%s", timeout, msg)
}

// Never asserts that a condition never becomes true within a timeout
func (a *Assert) Never(condition func() bool, timeout, interval time.Duration, msgAndArgs ...interface{}) {
	a.t.Helper()

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if condition() {
			msg := formatMessage(msgAndArgs...)
			a.t.Errorf("Condition unexpectedly became true%s", msg)
			return
		}
		time.Sleep(interval)
	}
}

// Panics asserts that the function panics
func (a *Assert) Panics(fn func(), msgAndArgs ...interface{}) {
	a.t.Helper()

	defer func() {
		if r := recover(); r == nil {
			msg := formatMessage(msgAndArgs...)
			a.t.Errorf("Expected panic%s", msg)
		}
	}()

	fn()
}

// NotPanics asserts that the function does not panic
func (a *Assert) NotPanics(fn func(), msgAndArgs ...interface{}) {
	a.t.Helper()

	defer func() {
		if r := recover(); r != nil {
			msg := formatMessage(msgAndArgs...)
			a.t.Errorf("Unexpected panic%s: %v", msg, r)
		}
	}()

	fn()
}

// WithinDuration asserts that actual time is within duration of expected
func (a *Assert) WithinDuration(expected, actual time.Time, delta time.Duration, msgAndArgs ...interface{}) {
	a.t.Helper()

	diff := expected.Sub(actual)
	if diff < 0 {
		diff = -diff
	}

	if diff > delta {
		msg := formatMessage(msgAndArgs...)
		a.t.Errorf("Times differ by %v, expected within %v%s", diff, delta, msg)
	}
}

// ========================================
// Context Helpers
// ========================================

// ContextWithTimeout creates a context with timeout for tests
func ContextWithTimeout(t *testing.T, timeout time.Duration) (context.Context, context.CancelFunc) {
	t.Helper()
	return context.WithTimeout(context.Background(), timeout)
}

// ========================================
// Helper Functions
// ========================================

func formatMessage(msgAndArgs ...interface{}) string {
	if len(msgAndArgs) == 0 {
		return ""
	}
	if len(msgAndArgs) == 1 {
		return " - " + msgAndArgs[0].(string)
	}
	return " - " + msgAndArgs[0].(string)
}

func isGreater(a, b interface{}) bool {
	switch av := a.(type) {
	case int:
		return av > b.(int)
	case int64:
		return av > b.(int64)
	case float64:
		return av > b.(float64)
	case time.Time:
		return av.After(b.(time.Time))
	}
	return false
}

func isGreaterOrEqual(a, b interface{}) bool {
	switch av := a.(type) {
	case int:
		return av >= b.(int)
	case int64:
		return av >= b.(int64)
	case float64:
		return av >= b.(float64)
	case time.Time:
		bv := b.(time.Time)
		return av.After(bv) || av.Equal(bv)
	}
	return false
}

func isLess(a, b interface{}) bool {
	switch av := a.(type) {
	case int:
		return av < b.(int)
	case int64:
		return av < b.(int64)
	case float64:
		return av < b.(float64)
	case time.Time:
		return av.Before(b.(time.Time))
	}
	return false
}

func isLessOrEqual(a, b interface{}) bool {
	switch av := a.(type) {
	case int:
		return av <= b.(int)
	case int64:
		return av <= b.(int64)
	case float64:
		return av <= b.(float64)
	case time.Time:
		bv := b.(time.Time)
		return av.Before(bv) || av.Equal(bv)
	}
	return false
}
