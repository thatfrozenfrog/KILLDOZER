pub fn password_to_des_key_bits(password: &[u8]) -> [u8; 56] {
    let mut bits = [0; 56];
    for byte in 0..8 {
        let value = password.get(byte).copied().unwrap_or(0) & 0x7f;
        for bit in 0..7 {
            bits[byte * 7 + bit] = (value >> (6 - bit)) & 1;
        }
    }
    bits
}

pub fn build_key_batch(batch: &[Vec<u8>]) -> [u64; 56] {
    let mut planes = [0; 56];
    for (lane, password) in batch.iter().enumerate() {
        for (bit, value) in password_to_des_key_bits(password).iter().enumerate() {
            if *value != 0 {
                planes[bit] |= 1u64 << lane;
            }
        }
    }
    planes
}

pub fn password_to_des_key(password: &[u8]) -> [u8; 8] {
    let mut out = [0; 8];
    for (dst, src) in out.iter_mut().zip(password.iter().copied()) {
        *dst = src << 1;
    }
    out
}
