//! Host tool for the parity check: prints the JSON for each file given.
fn main() {
    let art = std::env::var("ART_DIR").unwrap_or_default();
    let items: Vec<String> = std::env::args().skip(1).flat_map(|p| {
        let n = p.rsplit('/').next().unwrap_or("").to_string();
        [p, n]
    }).collect();
    println!("{}", quartz_core::parse_batch(&items.join("\u{1f}"), &art));
}
