use super::{
    bitslice::{extract_lane, BitsliceState},
    des::{encrypt, encrypt_bitsliced, round_keys},
    encoding::{encode_block, parse_hash},
    key::{build_key_batch, password_to_des_key},
    salt::salt_map,
};

pub fn descrypt_scalar(password: &[u8], salt: [u8; 2]) -> [u8; 13] {
    let keys = round_keys(password_to_des_key(password));
    let map = salt_map(salt);
    let mut block = 0;
    for _ in 0..25 {
        block = encrypt(block, &keys, &map);
    }
    let mut out = [0; 13];
    out[..2].copy_from_slice(&salt);
    out[2..].copy_from_slice(&encode_block(block));
    out
}

pub fn crack_candidates(
    hash: &[u8],
    candidates: Vec<Vec<u8>>,
) -> Result<Option<Vec<u8>>, &'static str> {
    let target = parse_hash(hash)?;
    let map = salt_map(target.salt);
    for batch in candidates.chunks(64) {
        let keys = build_key_batch(batch);
        let mut state: BitsliceState = [0; 64];
        for _ in 0..25 {
            encrypt_bitsliced(&mut state, &keys, &map);
        }
        for (lane, candidate) in batch.iter().enumerate() {
            if encode_block(extract_lane(&state, lane)) == target.checksum {
                return Ok(Some(candidate.clone()));
            }
        }
    }
    Ok(None)
}
