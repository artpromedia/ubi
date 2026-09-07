package move

import (
	"crypto/sha256"
	"encoding/base64"
	"strings"

	"github.com/google/uuid"
)

// Text ids in the shared tables are `<prefix>_<24 chars of a base64url sha256>`,
// the same shape services/config-service/src/lib/ids.ts writes, so a row is
// recognisable whichever service produced it.
func digest(input string) string {
	sum := sha256.Sum256([]byte(input))
	return base64.RawURLEncoding.EncodeToString(sum[:])[:24]
}

func newID(prefix string) string {
	return prefix + "_" + digest(uuid.NewString())
}

// deterministicID turns an idempotency key into the primary key of the row it
// creates, so a replay collides with its own earlier write instead of writing
// a second row. The database enforces idempotency, not a cache.
func deterministicID(prefix string, parts ...string) string {
	return prefix + "_" + digest(strings.Join(parts, "|"))
}
