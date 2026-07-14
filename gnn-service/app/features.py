import math
import networkx as nx
from datetime import datetime, timezone
from .models import GraphNode, GraphEdge

EMBEDDING_DIM = 64  # must match M3's Node2Vec output dimensionality

# Fixed vocabularies keep the feature vector shape stable across every
# request, regardless of which dynamic event labels a given patient has.
# Unseen types fall into the trailing "unknown" slot rather than changing
# the tensor shape, which would break the model's input layer.
NODE_TYPE_VOCAB = ["Patient", "HbA1c", "Walking", "Weight", "Medication", "Symptom", "UNKNOWN"]
REL_TYPE_VOCAB = ["HAS_EVENT", "SAME_TYPE_NEXT", "UNKNOWN"]

RECENCY_HALF_LIFE_DAYS = 90  # matches the recency decay already used in correlationEngine.ts


def _one_hot(value: str, vocab: list[str]) -> list[float]:
    vec = [0.0] * len(vocab)
    idx = vocab.index(value) if value in vocab else vocab.index("UNKNOWN")
    vec[idx] = 1.0
    return vec


def _recency_score(date_str: str | None) -> float:
    """Exponential decay — recent events score near 1.0, old events decay
    toward 0. Mirrors the `recency` factor already used in
    correlationEngine.ts's confidence formula, for consistency across the
    codebase's two independent scoring systems."""
    if not date_str:
        return 0.0
    try:
        event_date = datetime.fromisoformat(date_str).replace(tzinfo=timezone.utc)
    except ValueError:
        return 0.0
    days_ago = (datetime.now(timezone.utc) - event_date).days
    return math.exp(-max(0, days_ago) / RECENCY_HALF_LIFE_DAYS)


def build_graph(nodes: list[GraphNode], edges: list[GraphEdge]) -> nx.Graph:
    g = nx.Graph()
    for n in nodes:
        g.add_node(n.id)
    for e in edges:
        g.add_edge(e.source, e.target, relType=e.relType)
    return g


def build_node_features(
    nodes: list[GraphNode], graph: nx.Graph
) -> tuple[list[str], list[list[float]], list[str]]:
    """
    Feature vector per node = [embedding(64) | type one-hot | recency | degree]
    Total dim = EMBEDDING_DIM + len(NODE_TYPE_VOCAB) + 2

    Complexity: O(V) — degree_centrality is O(V + E) computed once up front,
    then O(1) lookup per node.
    """
    warnings: list[str] = []
    degree_centrality = nx.degree_centrality(graph)  # O(V + E), once

    # Type-frequency: how many nodes of this exact type this patient has —
    # cheap O(V) pass, reuses the same "count occurrences" idea already
    # used in categoricalItemExtractor.ts, just computed here in Python
    # since it's GNN-specific input, not something the legacy pipeline needs.
    type_counts: dict[str, int] = {}
    for n in nodes:
        key = n.type or "UNKNOWN"
        type_counts[key] = type_counts.get(key, 0) + 1
    max_count = max(type_counts.values()) if type_counts else 1

    node_ids: list[str] = []
    features: list[list[float]] = []

    for n in nodes:
        if n.embedding is None:
            warnings.append(f"Node {n.id} ({n.type}) missing embedding — using zero vector")
            embedding = [0.0] * EMBEDDING_DIM
        elif len(n.embedding) != EMBEDDING_DIM:
            warnings.append(
                f"Node {n.id} embedding has dim {len(n.embedding)}, expected {EMBEDDING_DIM} — using zero vector"
            )
            embedding = [0.0] * EMBEDDING_DIM
        else:
            embedding = n.embedding

        type_vec = _one_hot(n.type or "UNKNOWN", NODE_TYPE_VOCAB)
        recency = _recency_score(n.date)
        degree = degree_centrality.get(n.id, 0.0)
        frequency = type_counts.get(n.type or "UNKNOWN", 0) / max_count

        features.append(embedding + type_vec + [recency, degree, frequency])
        node_ids.append(n.id)

    return node_ids, features, warnings


def build_edge_features(
    edges: list[GraphEdge], nodes_by_id: dict[str, GraphNode], node_ids: list[str]
) -> tuple[list[list[int]], list[list[float]]]:
    """
    edge_index: [2, E] source/target indices into node_ids (PyG convention).
    edge_features per edge = [relType one-hot | temporal distance (days, normalized)]

    Complexity: O(E).
    """
    id_to_idx = {nid: i for i, nid in enumerate(node_ids)}
    edge_index: list[list[int]] = [[], []]
    edge_features: list[list[float]] = []

    for e in edges:
        if e.source not in id_to_idx or e.target not in id_to_idx:
            continue  # defensive — skip dangling edges rather than crash

        src_node = nodes_by_id.get(e.source)
        tgt_node = nodes_by_id.get(e.target)
        temporal_distance = 0.0
        if src_node and tgt_node and src_node.date and tgt_node.date:
            try:
                d1 = datetime.fromisoformat(src_node.date)
                d2 = datetime.fromisoformat(tgt_node.date)
                temporal_distance = min(1.0, abs((d2 - d1).days) / 365)  # normalized to ~1 year
            except ValueError:
                pass

        rel_vec = _one_hot(e.relType, REL_TYPE_VOCAB)
        edge_index[0].append(id_to_idx[e.source])
        edge_index[1].append(id_to_idx[e.target])
        edge_features.append(rel_vec + [temporal_distance])

    return edge_index, edge_features


def build_features(nodes: list[GraphNode], edges: list[GraphEdge]):
    graph = build_graph(nodes, edges)
    node_ids, node_features, warnings = build_node_features(nodes, graph)
    nodes_by_id = {n.id: n for n in nodes}
    edge_index, edge_features = build_edge_features(edges, nodes_by_id, node_ids)

    feature_dim = EMBEDDING_DIM + len(NODE_TYPE_VOCAB) + 3  # +recency +degree +frequency
    return node_ids, node_features, edge_index, edge_features, feature_dim, warnings