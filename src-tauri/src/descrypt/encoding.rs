pub const CRYPT_ALPHABET: &[u8; 64] =
    b"./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Target {
    pub salt: [u8; 2],
    pub checksum: [u8; 11],
}

pub fn decode_crypt_char(c: u8) -> Option<u8> {
    CRYPT_ALPHABET.iter().position(|&v| v == c).map(|v| v as u8)
}

pub fn parse_hash(input: &[u8]) -> Result<Target, &'static str> {
    if input.len() != 13 {
        return Err("traditional DES-crypt hashes are exactly 13 bytes");
    }
    if decode_crypt_char(input[0]).is_none() || decode_crypt_char(input[1]).is_none() {
        return Err("invalid salt character");
    }
    let mut checksum = [0; 11];
    checksum.copy_from_slice(&input[2..]);
    if checksum.iter().any(|&c| decode_crypt_char(c).is_none()) {
        return Err("invalid checksum character");
    }
    Ok(Target {
        salt: [input[0], input[1]],
        checksum,
    })
}

/// DES-crypt appends two zero bits, then writes eleven big-endian crypt-base64 groups.
pub fn encode_block(block: u64) -> [u8; 11] {
    let mut out = [b'.'; 11];
    for group in 0..10 {
        out[group] = CRYPT_ALPHABET[((block >> (58 - group * 6)) & 0x3f) as usize];
    }
    out[10] = CRYPT_ALPHABET[((block & 0x0f) << 2) as usize];
    out
}
