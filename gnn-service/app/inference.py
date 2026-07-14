import time
import itertools
import networkx as nx
import torch

from .models import GraphNode, GraphEdge
from .features import build_features, build_graph
from .model_registry import load_latest_model

MIN_CONFIDENCE_TO_REPORT = 0.5   # below this: not worth persisting at all
ACTIVE_CONFIDENCE_THRESHOLD = 0.75  # mirrors patternPersistence.ts's ACTIVE_THRESHOLD concept

# GraphSAGEEncoder is 2 layers -> receptive field is 2-hop neighborhood.
# supportingNodes/supportingEdges reflect exactly what the model could see,
# not an arbitrary window — this keeps "explainability" honest.
SUPPORTING_HOPS = 2


def _build_candidate_pairs(nodes: list[GraphNode], graph: nx.Graph) -> list[tuple[str, str]]:
    """
    Only event-vs-event pairs of DIFFERENT metric types, excluding pairs
    already directly connected (HAS_EVENT to Patient is irrelevant here;
    SAME_TYPE_NEXT pairs are already known relationships, not candidates).
    O(V^2) worst case, fine at per-patient scale (typically < 25 nodes).
    """
    event_nodes = [n for n in nodes if n.type != "Patient"]
    pairs = []
    for a, b in itertools.combinations(event_nodes, 2):
        if a.type == b.type:
            continue  # same-metric pairs are already chained via SAME_TYPE_NEXT
        if graph.has_edge(a.id, b.id):
            continue  # already a known direct relationship, not a "discovery"
        pairs.append((a.id, b.id))
    return pairs


def _supporting_subgraph(graph: nx.Graph, source: str, target: str):
    nodes_in_range = set()
    for n in (source, target):
        if n in graph:
            nodes_in_range |= set(nx.ego_graph(graph, n, radius=SUPPORTING_HOPS).nodes())
    edges_in_range = [
        {"source": u, "target": v, "relType": graph.edges[u, v].get("relType", "UNKNOWN")}
        for u, v in graph.edges(nodes_in_range)
        if u in nodes_in_range and v in nodes_in_range
    ]
    return list(nodes_in_range), edges_in_range


def _explain(source: GraphNode, target: GraphNode, confidence: float) -> str:
    return (
        f"The model found a structural association between {source.type} and "
        f"{target.type} events (confidence {confidence:.2f}), based on their "
        f"position and connections in the patient's event graph."
    )


def run_inference(nodes: list[GraphNode], edges: list[GraphEdge]):
    start = time.perf_counter()

    encoder, predictor, model_version = load_latest_model()

    node_ids, node_features, edge_index_list, _, _, warnings = build_features(nodes, edges)
    graph = build_graph(nodes, edges)

    if len(node_ids) < 2:
        return [], model_version, 0, (time.perf_counter() - start) * 1000

    x = torch.tensor(node_features, dtype=torch.float)
    edge_index = (
        torch.tensor(edge_index_list, dtype=torch.long)
        if edge_index_list[0]
        else torch.empty((2, 0), dtype=torch.long)
    )

    with torch.no_grad():
        z = encoder(x, edge_index)

    id_to_idx = {nid: i for i, nid in enumerate(node_ids)}
    nodes_by_id = {n.id: n for n in nodes}
    candidate_pairs = _build_candidate_pairs(nodes, graph)

    results = []
    for src_id, tgt_id in candidate_pairs:
        if src_id not in id_to_idx or tgt_id not in id_to_idx:
            continue
        src_idx, tgt_idx = id_to_idx[src_id], id_to_idx[tgt_id]

        with torch.no_grad():
            raw_score = (z[src_idx] * z[tgt_idx]).sum()
            confidence = torch.sigmoid(raw_score).item()

        if confidence < MIN_CONFIDENCE_TO_REPORT:
            continue

        supporting_nodes, supporting_edges = _supporting_subgraph(graph, src_id, tgt_id)

        results.append({
            "sourceNodeId": src_id,
            "targetNodeId": tgt_id,
            "relation": "ASSOCIATED_WITH",  # see design note (a) — direction left to M5
            "confidence": confidence,
            "supportingNodes": supporting_nodes,
            "supportingEdges": supporting_edges,
            "explanation": _explain(nodes_by_id[src_id], nodes_by_id[tgt_id], confidence),
        })

    results.sort(key=lambda r: r["confidence"], reverse=True)
    latency_ms = (time.perf_counter() - start) * 1000
    return results, model_version, len(candidate_pairs), latency_ms