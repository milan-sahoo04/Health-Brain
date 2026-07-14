# --- append to existing dataset.py ---
import torch
from .features import build_features
def build_combined_graph(patient_graphs: list[tuple[list, list]]):
    """
    Shared by both the synthetic dev path and the real-data training
    endpoint. Combines several patients' subgraphs into ONE training
    graph — disjoint components (patients don't share edges with each
    other), but one shared model learns across all of them. This is the
    literal mechanism behind "train one global model," same function
    build_synthetic_dataset already used, now generalized to accept
    real (nodes, edges) pairs instead of generating them.
    """
    all_node_ids, all_features, all_edge_index, all_edge_features = [], [], [], []
    offset = 0

    for nodes, edges in patient_graphs:
        node_ids, node_features, edge_index, edge_features, _, _ = build_features(nodes, edges)

        all_node_ids.extend(node_ids)
        all_features.extend(node_features)
        for s, t in zip(edge_index[0], edge_index[1]):
            all_edge_index.append((s + offset, t + offset))
        all_edge_features.extend(edge_features)

        offset += len(node_ids)

    x = torch.tensor(all_features, dtype=torch.float)
    edge_index = (
        torch.tensor(all_edge_index, dtype=torch.long).t().contiguous()
        if all_edge_index
        else torch.empty((2, 0), dtype=torch.long)
    )
    return x, edge_index, all_node_ids