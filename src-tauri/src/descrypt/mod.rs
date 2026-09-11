mod bitslice;
mod crypt;
mod des;
mod encoding;
mod key;
mod salt;

pub fn validate(hash: &str) -> Result<(), String> {
    encoding::parse_hash(hash.as_bytes())
        .map(|_| ())
        .map_err(str::to_owned)
}

pub fn crack(hash: &str, candidates: Vec<Vec<u8>>) -> Result<Option<Vec<u8>>, String> {
    crypt::crack_candidates(hash.as_bytes(), candidates).map_err(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cracks_a_known_des_crypt_vector() {
        assert_eq!(
            crack(
                "abJnggxhB/yWI",
                vec![b"wrong".to_vec(), b"password".to_vec()]
            )
            .unwrap(),
            Some(b"password".to_vec())
        );
    }
}
