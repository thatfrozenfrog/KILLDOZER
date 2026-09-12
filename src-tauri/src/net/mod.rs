use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    fs::File,
    io::BufReader,
    path::Path,
    sync::OnceLock,
};

/// Default embedded hostmap dataset.
pub const DEFAULT_UUMAP_JSON: &str = include_str!("uumap_all_cleaned.json");

static GLOBAL_HOSTMAP: OnceLock<HostMap> = OnceLock::new();

/// Returns a reference to the global statically embedded HostMap.
/// Initialized once on first access and cached in memory for the lifetime of the process.
pub fn global() -> &'static HostMap {
    GLOBAL_HOSTMAP.get_or_init(|| {
        HostMap::load_default()
            .expect("Failed to initialize static HostMap from uumap_all_cleaned.json")
    })
}

/// Host metadata stored in the uumap JSON.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HostInfo {
    #[serde(default)]
    pub os: Option<String>,
    #[serde(default)]
    pub conn: Vec<String>,
    #[serde(default)]
    pub nconns: Option<usize>,
}

/// In-memory graph of the host network optimized for rapid pathfinding queries.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct HostMap {
    /// Full host metadata map (hostname -> HostInfo)
    hosts: HashMap<String, HostInfo>,
    /// Fast string-to-index mapping for graph traversal
    name_to_idx: HashMap<String, u32>,
    /// Index-to-string mapping for path reconstruction
    idx_to_name: Vec<String>,
    /// Directed adjacency list: index -> outgoing neighbor indices
    adjacency: Vec<Vec<u32>>,
    /// Undirected adjacency list: index -> neighbor indices (bidirectional)
    adjacency_undirected: Vec<Vec<u32>>,
    /// Total edge count in directed graph
    edge_count: usize,
}

impl HostMap {
    /// Builds a `HostMap` from a JSON string.
    pub fn from_json_str(json_str: &str) -> Result<Self, serde_json::Error> {
        let raw_hosts: HashMap<String, HostInfo> = serde_json::from_str(json_str)?;
        Ok(Self::from_parsed_hosts(raw_hosts))
    }

    /// Builds a `HostMap` from a file path using a buffered reader.
    pub fn from_file<P: AsRef<Path>>(
        path: P,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let file = File::open(path)?;
        let reader = BufReader::new(file);
        let raw_hosts: HashMap<String, HostInfo> = serde_json::from_reader(reader)?;
        Ok(Self::from_parsed_hosts(raw_hosts))
    }

    /// Loads the embedded `uumap_all_cleaned.json` dataset.
    pub fn load_default() -> Result<Self, serde_json::Error> {
        Self::from_json_str(DEFAULT_UUMAP_JSON)
    }

    /// Construct internal graph tables from the raw host map.
    fn from_parsed_hosts(hosts: HashMap<String, HostInfo>) -> Self {
        let mut name_to_idx: HashMap<String, u32> = HashMap::with_capacity(hosts.len() + 64);
        let mut idx_to_name: Vec<String> = Vec::with_capacity(hosts.len() + 64);

        // Helper to register or look up a node index
        let get_or_create_idx =
            |name: &str, n2i: &mut HashMap<String, u32>, i2n: &mut Vec<String>| -> u32 {
                if let Some(&idx) = n2i.get(name) {
                    idx
                } else {
                    let new_idx = i2n.len() as u32;
                    let s = name.to_string();
                    n2i.insert(s.clone(), new_idx);
                    i2n.push(s);
                    new_idx
                }
            };

        // First pass: assign indices for all primary hosts
        for host in hosts.keys() {
            get_or_create_idx(host, &mut name_to_idx, &mut idx_to_name);
        }

        let num_nodes = idx_to_name.len();
        let mut adjacency: Vec<Vec<u32>> = vec![Vec::new(); num_nodes];
        let mut adjacency_undirected: Vec<Vec<u32>> = vec![Vec::new(); num_nodes];
        let mut edge_count = 0;

        // Second pass: populate directed and undirected edges
        for (host_name, info) in &hosts {
            let u = *name_to_idx.get(host_name).unwrap();

            for target in &info.conn {
                // Ensure target has an index (handles rare nodes referenced in conn only)
                let v = get_or_create_idx(target, &mut name_to_idx, &mut idx_to_name);

                // Expand adjacency lists if new target node was appended
                if v as usize >= adjacency.len() {
                    adjacency.resize(v as usize + 1, Vec::new());
                    adjacency_undirected.resize(v as usize + 1, Vec::new());
                }

                adjacency[u as usize].push(v);
                adjacency_undirected[u as usize].push(v);
                adjacency_undirected[v as usize].push(u);
                edge_count += 1;
            }
        }

        Self {
            hosts,
            name_to_idx,
            idx_to_name,
            adjacency,
            adjacency_undirected,
            edge_count,
        }
    }

    /// Retrieve host details if present in the map.
    pub fn get_host(&self, name: &str) -> Option<&HostInfo> {
        self.hosts.get(name)
    }

    /// Retrieve host OS if known.
    pub fn get_os(&self, name: &str) -> Option<&str> {
        self.hosts.get(name).and_then(|h| h.os.as_deref())
    }

    /// Returns `true` if the host is known.
    pub fn contains_host(&self, name: &str) -> bool {
        self.name_to_idx.contains_key(name)
    }

    /// Number of total indexed hosts.
    pub fn host_count(&self) -> usize {
        self.idx_to_name.len()
    }

    /// Number of total directed connections.
    pub fn edge_count(&self) -> usize {
        self.edge_count
    }

    /// Finds the shortest directed path from `from_host` to `to_host` using Breadth-First Search (BFS).
    /// Returns `Some(vec![from, hop1, hop2, ..., to])`, or `None` if unreachable.
    pub fn shortest_path(&self, from_host: &str, to_host: &str) -> Option<Vec<String>> {
        let from_idx = *self.name_to_idx.get(from_host)?;
        let to_idx = *self.name_to_idx.get(to_host)?;
        self.bfs(from_idx, to_idx, &self.adjacency)
    }

    /// Finds the shortest path treating connections as bidirectional (undirected).
    pub fn shortest_path_undirected(&self, from_host: &str, to_host: &str) -> Option<Vec<String>> {
        let from_idx = *self.name_to_idx.get(from_host)?;
        let to_idx = *self.name_to_idx.get(to_host)?;
        self.bfs(from_idx, to_idx, &self.adjacency_undirected)
    }

    /// Breadth-First Search traversal on indexed nodes.
    fn bfs(&self, start: u32, target: u32, adj: &[Vec<u32>]) -> Option<Vec<String>> {
        if start == target {
            return Some(vec![self.idx_to_name[start as usize].clone()]);
        }

        let num_nodes = self.idx_to_name.len();
        let mut parent = vec![u32::MAX; num_nodes];
        let mut queue = VecDeque::new();

        parent[start as usize] = start;
        queue.push_back(start);

        let mut found = false;

        while let Some(curr) = queue.pop_front() {
            if curr == target {
                found = true;
                break;
            }

            if let Some(neighbors) = adj.get(curr as usize) {
                for &next in neighbors {
                    if parent[next as usize] == u32::MAX {
                        parent[next as usize] = curr;
                        queue.push_back(next);
                    }
                }
            }
        }

        if !found {
            return None;
        }

        // Reconstruct path backward
        let mut path = Vec::new();
        let mut curr = target;
        while curr != start {
            path.push(self.idx_to_name[curr as usize].clone());
            curr = parent[curr as usize];
        }
        path.push(self.idx_to_name[start as usize].clone());
        path.reverse();

        Some(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_query_two_real_hosts() {
        let from = std::env::var("FROM").unwrap_or_else(|_| "csdev".to_string());
        let to = std::env::var("TO").unwrap_or_else(|_| "loki".to_string());

        let map = HostMap::load_default().expect("Failed to load uumap_all_cleaned.json");
        println!("\n==========================================");
        println!("Querying shortest path: '{}' -> '{}'", from, to);
        println!("==========================================");

        assert!(
            map.contains_host(&from),
            "Host '{}' not found in uumap",
            from
        );
        assert!(map.contains_host(&to), "Host '{}' not found in uumap", to);

        let start = std::time::Instant::now();
        if let Some(path) = map.shortest_path(&from, &to) {
            println!(
                "✓ Found directed path ({} hops) in {:?}:",
                path.len() - 1,
                start.elapsed()
            );
            for (i, node) in path.iter().enumerate() {
                let os = map.get_os(node).unwrap_or("?");
                println!("  [{}] {} ({})", i, node, os);
            }
            println!("Full path: {}\n", path.join(" -> "));
            assert_eq!(path.first().unwrap(), &from);
            assert_eq!(path.last().unwrap(), &to);
        } else {
            println!("✗ No directed path found between '{}' and '{}'", from, to);
            if let Some(undir) = map.shortest_path_undirected(&from, &to) {
                println!("  (An undirected path exists: {})\n", undir.join(" <-> "));
            }
        }
    }
}
