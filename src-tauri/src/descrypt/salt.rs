use super::des::E;
use super::encoding::decode_crypt_char;
#[derive(Clone)]
pub struct SaltMap {
    pub expansion: [usize; 48],
}
pub fn salt_map(salt: [u8; 2]) -> SaltMap {
    let mut expansion = E.map(|v| v - 1);
    let bits = decode_crypt_char(salt[0]).unwrap() as u16
        | ((decode_crypt_char(salt[1]).unwrap() as u16) << 6);
    for i in 0..12 {
        if (bits >> i) & 1 != 0 {
            expansion.swap(i, i + 24);
        }
    }
    SaltMap { expansion }
}
