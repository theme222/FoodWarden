// Host-only stand-in for <mbedtls/gcm.h>. Declarations copied from the ESP32
// mbedtls header (same names, argument order and types) so fridge/src/crypto.cpp
// compiles unchanged; implemented in gcm_host.cpp (Windows BCrypt or OpenSSL).
#ifndef HOST_STUB_MBEDTLS_GCM_H
#define HOST_STUB_MBEDTLS_GCM_H

#include <stddef.h>
#include <stdint.h>

#define MBEDTLS_GCM_ENCRYPT 1
#define MBEDTLS_GCM_DECRYPT 0

typedef enum { MBEDTLS_CIPHER_ID_NONE = 0, MBEDTLS_CIPHER_ID_NULL, MBEDTLS_CIPHER_ID_AES } mbedtls_cipher_id_t;

typedef struct {
  unsigned char key[32];
  unsigned int keybits;
  int cipher;
} mbedtls_gcm_context;

void mbedtls_gcm_init(mbedtls_gcm_context *ctx);
int mbedtls_gcm_setkey(mbedtls_gcm_context *ctx, mbedtls_cipher_id_t cipher,
                       const unsigned char *key, unsigned int keybits);
int mbedtls_gcm_crypt_and_tag(mbedtls_gcm_context *ctx, int mode, size_t length,
                              const unsigned char *iv, size_t iv_len,
                              const unsigned char *add, size_t add_len,
                              const unsigned char *input, unsigned char *output,
                              size_t tag_len, unsigned char *tag);
void mbedtls_gcm_free(mbedtls_gcm_context *ctx);

#endif
