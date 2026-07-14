import os
import json
from datetime import datetime, timezone

import torch
from torch_geometric.utils import negative_sampling

from .model import GraphSAGEEncoder, LinkPredictor
from .features import EMBEDDING_DIM, NODE_TYPE_VOCAB

FEATURE_DIM = EMBEDDING_DIM + len(NODE_TYPE_VOCAB) + 3
HIDDEN_DIM = 32
LR = 0.01

MODELS_DIR = os.path.join(os.path.dirname(__file__), "..", "models")


def train_model(x: torch.Tensor, edge_index: torch.Tensor, epochs: int, dataset_version: str):
    """
    The actual GraphSAGE + link-prediction training loop — identical logic
    regardless of whether x/edge_index came from synthetic data (dev/test)
    or real Aura patients (production). Saves a versioned checkpoint and
    returns metadata matching PatternCandidate's modelVersion/datasetVersion
    fields.
    """
    encoder = GraphSAGEEncoder(in_channels=FEATURE_DIM, hidden_channels=HIDDEN_DIM, out_channels=HIDDEN_DIM)
    predictor = LinkPredictor()
    optimizer = torch.optim.Adam(list(encoder.parameters()) + list(predictor.parameters()), lr=LR)

    encoder.train()
    loss_value = None
    for epoch in range(1, epochs + 1):
        optimizer.zero_grad()
        z = encoder(x, edge_index)

        neg_edge_index = negative_sampling(
            edge_index=edge_index, num_nodes=x.size(0), num_neg_samples=edge_index.size(1)
        )
        pos_score = predictor(z, edge_index)
        neg_score = predictor(z, neg_edge_index)

        scores = torch.cat([pos_score, neg_score])
        labels = torch.cat([torch.ones(pos_score.size(0)), torch.zeros(neg_score.size(0))])

        loss = torch.nn.functional.binary_cross_entropy_with_logits(scores, labels)
        loss.backward()
        optimizer.step()
        loss_value = loss.item()

        if epoch % 10 == 0 or epoch == 1:
            print(f"Epoch {epoch:3d} | loss = {loss_value:.4f}")

    model_version = f"gnn-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    version_dir = os.path.join(MODELS_DIR, model_version)
    os.makedirs(version_dir, exist_ok=True)

    torch.save(encoder.state_dict(), os.path.join(version_dir, "encoder.pt"))
    torch.save(predictor.state_dict(), os.path.join(version_dir, "predictor.pt"))

    metadata = {
        "modelVersion": model_version,
        "datasetVersion": dataset_version,
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "featureDim": FEATURE_DIM,
        "hiddenDim": HIDDEN_DIM,
        "epochs": epochs,
        "finalLoss": loss_value,
        "numNodes": x.size(0),
        "numEdges": edge_index.size(1),
    }
    with open(os.path.join(version_dir, "metadata.json"), "w") as f:
        json.dump(metadata, f, indent=2)
    with open(os.path.join(MODELS_DIR, "latest.json"), "w") as f:
        json.dump({"modelVersion": model_version}, f, indent=2)

    return metadata