package secrets

// basic interface, but it allows to change the implementation
// in the future with a more secure solution (e.g. KMS)
type Cipher interface {
	Encrypt(string) (string, error)
	Decrypt(string) (string, error)
}

// update this whenever the implementation changes and tokens must be invalidated
const versionPrefix = "v1:"
