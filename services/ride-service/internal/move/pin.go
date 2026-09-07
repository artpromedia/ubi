package move

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

// pinDigits is the length of a pickup PIN. It is a property of the PIN itself
// rather than a city policy: city config decides whether a PIN is required and
// how many attempts a driver gets, both of which are read from config.
const pinDigits = 4

// generatePIN returns a uniformly random pickup PIN from the system CSPRNG.
func generatePIN() (string, error) {
	var builder strings.Builder
	for i := 0; i < pinDigits; i++ {
		digit, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			return "", fmt.Errorf("failed to generate PIN: %w", err)
		}
		builder.WriteString(digit.String())
	}
	return builder.String(), nil
}

// hashPIN hashes a PIN for storage. A PIN is short enough to brute-force
// offline given the hash, which is why the attempt limit in city config — not
// the hash — is the real control; the hash only stops a database reader from
// walking up to a rider and reading their PIN off a screen.
func hashPIN(pin string) ([]byte, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(pin), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash PIN: %w", err)
	}
	return hash, nil
}

// pinMatches compares a candidate against the stored hash in constant time.
func pinMatches(hash []byte, candidate string) bool {
	return bcrypt.CompareHashAndPassword(hash, []byte(candidate)) == nil
}

// validPINFormat rejects anything that is not a PIN before it is hashed, so a
// long or non-numeric string cannot be used to burn attempts cheaply.
func validPINFormat(pin string) bool {
	if len(pin) != pinDigits {
		return false
	}
	for _, r := range pin {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}
