use std::io::{self, Write};

#[path = "../src/net/mod.rs"]
mod net;

use net::HostMap;

fn main() {
    println!("Loading uumap_all_cleaned.json into memory...");
    let start = std::time::Instant::now();
    let map = HostMap::load_default().expect("Failed to load uumap_all_cleaned.json");
    println!(
        "Loaded {} hosts with {} connections in {:.2?}!\n",
        map.host_count(),
        map.edge_count(),
        start.elapsed()
    );

    let mut args = std::env::args().skip(1);
    let from_arg = args.next();
    let to_arg = args.next();

    let (from_host, to_host) = match (from_arg, to_arg) {
        (Some(f), Some(t)) => (f, t),
        _ => {
            print!("Enter starting host (e.g. csdev): ");
            io::stdout().flush().unwrap();
            let mut from_buf = String::new();
            io::stdin().read_line(&mut from_buf).unwrap();
            let from_host = from_buf.trim().to_string();

            print!("Enter target host (e.g. loki): ");
            io::stdout().flush().unwrap();
            let mut to_buf = String::new();
            io::stdin().read_line(&mut to_buf).unwrap();
            let to_host = to_buf.trim().to_string();

            (from_host, to_host)
        }
    };

    if !map.contains_host(&from_host) {
        eprintln!("Error: Starting host '{}' not found in hostmap.", from_host);
        std::process::exit(1);
    }
    if !map.contains_host(&to_host) {
        eprintln!("Error: Target host '{}' not found in hostmap.", to_host);
        std::process::exit(1);
    }

    println!(
        "Searching shortest path from '{}' to '{}'...",
        from_host, to_host
    );
    let search_start = std::time::Instant::now();

    match map.shortest_path(&from_host, &to_host) {
        Some(path) => {
            let elapsed = search_start.elapsed();
            println!(
                "\nFound directed path ({} hops, {} nodes) in {:.2?}:\n",
                path.len() - 1,
                path.len(),
                elapsed
            );
            for (i, node) in path.iter().enumerate() {
                let os_info = map.get_os(node).unwrap_or("Unknown OS");
                if i == 0 {
                    println!("  [0] Start:  {} ({})", node, os_info);
                } else if i == path.len() - 1 {
                    println!("  [{}] Target: {} ({})", i, node, os_info);
                } else {
                    println!("  [{}] Hop:    {} ({})", i, node, os_info);
                }
            }
            println!("\nRoute: {}", path.join(" -> "));
        }
        None => {
            println!(
                "No directed path found from '{}' to '{}' (checked in {:.2?}).",
                from_host,
                to_host,
                search_start.elapsed()
            );

            // Check if undirected path exists
            if let Some(undir_path) = map.shortest_path_undirected(&from_host, &to_host) {
                println!(
                    "\nNote: An undirected/reverse path exists ({} hops):\n{}",
                    undir_path.len() - 1,
                    undir_path.join(" <-> ")
                );
            }
        }
    }
}
