// Host-only AES-GCM behind the mbedtls_gcm_* names used by src/crypto.cpp.
// Windows: CNG (BCrypt, built into the OS). Linux / macOS: OpenSSL (libcrypto).
#include <string.h>

#include "mbedtls/gcm.h"

#ifdef _WIN32
#include <windows.h>
#include <bcrypt.h>
#else
#include <openssl/evp.h>
#endif

void mbedtls_gcm_init(mbedtls_gcm_context *ctx) { memset(ctx, 0, sizeof(*ctx)); }

int mbedtls_gcm_setkey(mbedtls_gcm_context *ctx, mbedtls_cipher_id_t cipher,
                       const unsigned char *key, unsigned int keybits) {
  if (cipher != MBEDTLS_CIPHER_ID_AES || keybits != 128) return -1;
  memcpy(ctx->key, key, 16);
  ctx->keybits = keybits;
  ctx->cipher = cipher;
  return 0;
}

#ifdef _WIN32
int mbedtls_gcm_crypt_and_tag(mbedtls_gcm_context *ctx, int mode, size_t length,
                              const unsigned char *iv, size_t iv_len,
                              const unsigned char *add, size_t add_len,
                              const unsigned char *input, unsigned char *output,
                              size_t tag_len, unsigned char *tag) {
  if (mode != MBEDTLS_GCM_ENCRYPT || ctx->keybits == 0) return -1;
  BCRYPT_ALG_HANDLE alg = nullptr;
  BCRYPT_KEY_HANDLE key = nullptr;
  int rc = -1;
  if (BCryptOpenAlgorithmProvider(&alg, BCRYPT_AES_ALGORITHM, nullptr, 0) != 0) return -1;
  if (BCryptSetProperty(alg, BCRYPT_CHAINING_MODE, (PUCHAR)BCRYPT_CHAIN_MODE_GCM,
                        sizeof(BCRYPT_CHAIN_MODE_GCM), 0) == 0 &&
      BCryptGenerateSymmetricKey(alg, &key, nullptr, 0, ctx->key, 16, 0) == 0) {
    BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO info;
    BCRYPT_INIT_AUTH_MODE_INFO(info);
    info.pbNonce = (PUCHAR)iv;
    info.cbNonce = (ULONG)iv_len;
    info.pbAuthData = (PUCHAR)add;
    info.cbAuthData = (ULONG)add_len;
    info.pbTag = tag;
    info.cbTag = (ULONG)tag_len;
    ULONG written = 0;
    if (BCryptEncrypt(key, (PUCHAR)input, (ULONG)length, &info, nullptr, 0, output,
                      (ULONG)length, &written, 0) == 0 &&
        written == length) {
      rc = 0;
    }
  }
  if (key) BCryptDestroyKey(key);
  BCryptCloseAlgorithmProvider(alg, 0);
  return rc;
}
#else
int mbedtls_gcm_crypt_and_tag(mbedtls_gcm_context *ctx, int mode, size_t length,
                              const unsigned char *iv, size_t iv_len,
                              const unsigned char *add, size_t add_len,
                              const unsigned char *input, unsigned char *output,
                              size_t tag_len, unsigned char *tag) {
  if (mode != MBEDTLS_GCM_ENCRYPT || ctx->keybits == 0) return -1;
  EVP_CIPHER_CTX *c = EVP_CIPHER_CTX_new();
  int len = 0;
  int ok = c != nullptr &&
           EVP_EncryptInit_ex(c, EVP_aes_128_gcm(), nullptr, nullptr, nullptr) == 1 &&
           EVP_CIPHER_CTX_ctrl(c, EVP_CTRL_GCM_SET_IVLEN, (int)iv_len, nullptr) == 1 &&
           EVP_EncryptInit_ex(c, nullptr, nullptr, ctx->key, iv) == 1 &&
           EVP_EncryptUpdate(c, nullptr, &len, add, (int)add_len) == 1 &&
           EVP_EncryptUpdate(c, output, &len, input, (int)length) == 1 &&
           EVP_EncryptFinal_ex(c, output + len, &len) == 1 &&
           EVP_CIPHER_CTX_ctrl(c, EVP_CTRL_GCM_GET_TAG, (int)tag_len, tag) == 1;
  EVP_CIPHER_CTX_free(c);
  return ok ? 0 : -1;
}
#endif

void mbedtls_gcm_free(mbedtls_gcm_context *ctx) { memset(ctx, 0, sizeof(*ctx)); }
