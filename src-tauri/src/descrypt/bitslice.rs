pub type BsWord = u64;
pub const LANES: usize = 64;
pub type BitsliceState = [BsWord; 64];
pub fn extract_lane(state: &BitsliceState, lane: usize) -> u64 {
    state
        .iter()
        .fold(0, |value, &plane| (value << 1) | ((plane >> lane) & 1))
}
