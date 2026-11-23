import struct, subprocess, sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.exceptions import InvalidTag

out = subprocess.run([sys.argv[1]], capture_output=True, text=True).stdout.splitlines()
key = bytes(range(16))
fails = 0


def chk(c, m):
    global fails
    print(("ok:   " if c else "FAIL: ") + m)
    fails += (not c)


i = 0
for N in (1, 6):
    blob = bytes.fromhex(out[i + 1])
    i += 2
    chk(len(blob) == 32 + 14 * N, f"N={N}: length {len(blob)} == 32+N*14")
    version, node, salt, counter = struct.unpack("<B2s8sI", blob[:15])
    chk((version, node, counter) == (1, b"F0", 0x01020304) and salt.hex() == "a1b2c3d4e5f60718",
        f"N={N}: header fields parse")
    iv = salt + struct.pack("<I", counter)
    try:
        pt = AESGCM(key).decrypt(iv, blob[15:], blob[:15])
        chk(True, f"N={N}: decrypts, tag + AAD valid")
    except InvalidTag:
        chk(False, f"N={N}: decrypt failed")
        continue
    chk(len(pt) == 1 + 14 * N and pt[0] == N, f"N={N}: payload size and sample_count")
    for k in range(N):
        ts, t, v, l = struct.unpack_from("<QhHH", pt, 1 + 14 * k)
        exp_t = -32768 if (N == 6 and k == 5) else 342 + k
        exp_v = 0xFFFF if k == 2 else 100 + k
        chk((ts, t, v, l) == (1767225600 + 5 * k, exp_t, exp_v, 10 + k),
            f"N={N}: sample {k} = ts {ts} temp {t} voc {v} light {l}")
    for name, pos in (("AAD", 2), ("ciphertext", 20)):
        bad = bytearray(blob)
        bad[pos] ^= 1
        try:
            AESGCM(key).decrypt(iv, bytes(bad[15:]), bytes(bad[:15]))
            chk(False, f"N={N}: {name} tamper rejected")
        except InvalidTag:
            chk(True, f"N={N}: {name} tamper rejected")
chk(out[i] == "bad_count0=0 bad_count7=0 small_buf=0", "invalid count / small buffer return 0")
print("PACKET CHECK", "FAILED" if fails else "PASSED")
sys.exit(1 if fails else 0)
