package secrets

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"strings"
)

type AESGCMCipher struct {
	aead cipher.AEAD
}

func NewAESGCMCipher(key []byte) (*AESGCMCipher, error) {
	blk, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("invalid encryption key: %w", err)
	}

	aead, err := cipher.NewGCM(blk)
	if err != nil {
		return nil, fmt.Errorf("failed to build AEAD: %w", err)
	}

	return &AESGCMCipher{aead: aead}, nil
}

func (c *AESGCMCipher) Encrypt(plaintext string) (string, error) {
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("failed to generate nonce: %w", err)
	}

	sealed := c.aead.Seal(nonce, nonce, []byte(plaintext), nil) // nonce || ciphertext
	b64sealed := base64.StdEncoding.EncodeToString(sealed)
	return versionPrefix + b64sealed, nil
}

func (c *AESGCMCipher) Decrypt(ciphertext string) (string, error) {
	encoded, ok := strings.CutPrefix(ciphertext, versionPrefix)
	if !ok {
		return "", fmt.Errorf("unsupported ciphertext format")
	}

	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", fmt.Errorf("invalid ciphertext encoding: %w", err)
	}

	ns := c.aead.NonceSize()
	if len(raw) < ns {
		return "", fmt.Errorf("invalid ciphertext: too short")
	}

	plaintext, err := c.aead.Open(nil, raw[:ns], raw[ns:], nil)
	if err != nil {
		return "", fmt.Errorf("failed to decrypt: %w", err)
	}

	return string(plaintext), nil
}
