package secrets

import (
	"encoding/base64"
	"strings"
	"testing"
)

func testKey(t *testing.T, fill byte) []byte {
	t.Helper()
	key := make([]byte, 32)
	for i := range key {
		key[i] = fill
	}
	return key
}

func TestRoundTrip(t *testing.T) {
	c, err := NewAESGCMCipher(testKey(t, 1))
	if err != nil {
		t.Fatalf("NewAESGCMCipher: %v", err)
	}

	for _, plaintext := range []string{"a", "gho_1234567890", strings.Repeat("x", 4096)} {
		encrypted, err := c.Encrypt(plaintext)
		if err != nil {
			t.Fatalf("Encrypt(%q): %v", plaintext, err)
		}
		if !strings.HasPrefix(encrypted, versionPrefix) {
			t.Fatalf("Encrypt(%q) = %q, want %q prefix", plaintext, encrypted, versionPrefix)
		}

		decrypted, err := c.Decrypt(encrypted)
		if err != nil {
			t.Fatalf("Decrypt(%q): %v", encrypted, err)
		}
		if decrypted != plaintext {
			t.Fatalf("Decrypt round trip = %q, want %q", decrypted, plaintext)
		}
	}
}

func TestEncryptUsesFreshNonce(t *testing.T) {
	c, err := NewAESGCMCipher(testKey(t, 1))
	if err != nil {
		t.Fatalf("NewAESGCMCipher: %v", err)
	}

	first, err := c.Encrypt("same plaintext")
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	second, err := c.Encrypt("same plaintext")
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}

	if first == second {
		t.Fatal("Encrypt returned identical ciphertext for the same plaintext; nonce is not fresh")
	}
}

func TestNewAESGCMCipherRejectsInvalidKeySize(t *testing.T) {
	for _, size := range []int{0, 16, 24, 31, 33, 64} {
		if _, err := NewAESGCMCipher(make([]byte, size)); err == nil {
			t.Fatalf("NewAESGCMCipher accepted a %d-byte key, want error", size)
		}
	}
}

func TestDecryptWithWrongKeyFails(t *testing.T) {
	encryptor, err := NewAESGCMCipher(testKey(t, 1))
	if err != nil {
		t.Fatalf("NewAESGCMCipher: %v", err)
	}
	decryptor, err := NewAESGCMCipher(testKey(t, 2))
	if err != nil {
		t.Fatalf("NewAESGCMCipher: %v", err)
	}

	encrypted, err := encryptor.Encrypt("secret")
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}

	if _, err := decryptor.Decrypt(encrypted); err == nil {
		t.Fatal("Decrypt with a different key succeeded, want error")
	}
}

func TestDecryptDetectsTampering(t *testing.T) {
	c, err := NewAESGCMCipher(testKey(t, 1))
	if err != nil {
		t.Fatalf("NewAESGCMCipher: %v", err)
	}

	encrypted, err := c.Encrypt("secret")
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}

	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(encrypted, versionPrefix))
	if err != nil {
		t.Fatalf("decode ciphertext: %v", err)
	}
	raw[len(raw)-1] ^= 0xff
	tampered := versionPrefix + base64.StdEncoding.EncodeToString(raw)

	if _, err := c.Decrypt(tampered); err == nil {
		t.Fatal("Decrypt accepted tampered ciphertext, want error")
	}
}

func TestDecryptRejectsMalformedInput(t *testing.T) {
	c, err := NewAESGCMCipher(testKey(t, 1))
	if err != nil {
		t.Fatalf("NewAESGCMCipher: %v", err)
	}

	cases := map[string]string{
		"empty":          "",
		"unknown prefix": "v9:AAAA",
		"no prefix":      "ZGVhZGJlZWY=",
		"invalid base64": versionPrefix + "!!!not-base64!!!",
		"too short":      versionPrefix + base64.StdEncoding.EncodeToString([]byte("short")),
	}

	for name, input := range cases {
		if _, err := c.Decrypt(input); err == nil {
			t.Errorf("Decrypt(%s) succeeded, want error", name)
		}
	}
}
