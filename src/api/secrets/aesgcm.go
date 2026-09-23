package secrets

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"fmt"
	"io"
)

type AESGCMCipher struct {
	key []byte
}

func NewAESGCMCipher(key string) (*AESGCMCipher, error) {
	if len(key) == 0 {
		return nil, fmt.Errorf("encryption key not set")
	}
	return &AESGCMCipher{key: []byte(key)}, nil
}

func (c *AESGCMCipher) Encrypt(plaintext string) (string, error) {
	if len(plaintext) == 0 {
		return "", fmt.Errorf("empty string passed to Encrypt()")
	}

	blk, err := aes.NewCipher(c.key)
	if err != nil {
		return "", err
	}

	aesgcm, err := cipher.NewGCM(blk)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, aesgcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	ciphertext := aesgcm.Seal(nil, nonce, []byte(plaintext), nil)

	// concat nonce||ciphertext, nonce is always 12 bytes (aesgcm.NonceSize())
	return string(nonce) + string(ciphertext), nil
}

func (c *AESGCMCipher) Decrypt(encrypted string) (string, error) {
	if len(encrypted) == 0 {
		return "", fmt.Errorf("empty string passed to Decrypt()")
	}

	blk, err := aes.NewCipher(c.key)
	if err != nil {
		return "", err
	}

	aesgcm, err := cipher.NewGCM(blk)
	if err != nil {
		return "", err
	}

	if len(encrypted) < aesgcm.NonceSize() {
		return "", fmt.Errorf("invalid ciphertext")
	}

	nonce := encrypted[:aesgcm.NonceSize()]
	ciphertext := encrypted[aesgcm.NonceSize():]

	plaintext, err := aesgcm.Open(nil, []byte(nonce), []byte(ciphertext), nil)
	if err != nil {
		return "", err
	}

	return string(plaintext), nil
}
