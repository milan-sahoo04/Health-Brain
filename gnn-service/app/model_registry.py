import os
import json
import torch

from .model import GraphSAGEEncoder, LinkPredictor
from .features import EMBEDDING_DIM, NODE_TYPE_VOCAB

FEATURE_DIM = EMBEDDING_DIM + len(NODE_TYPE_VOCAB) + 3
HIDDEN_DIM = 32
MODELS_DIR = os.path.join(os.path.dirname(__file__), "..", "models")


class ModelNotFoundError(Exception):
    pass


def load_latest_model():
    """
    Loads whatever checkpoint models/latest.json currently points to.
    Called once per /infer request (simple, correct for POC volume) —
    if inference latency becomes a bottleneck at scale, this is the first
    place to add an in-memory cache with file-mtime invalidation.
    """
    latest_path = os.path.join(MODELS_DIR, "latest.json")
    if not os.path.exists(latest_path):
        raise ModelNotFoundError("No trained model found — run training first (M4.3)")

    with open(latest_path) as f:
        model_version = json.load(f)["modelVersion"]

    version_dir = os.path.join(MODELS_DIR, model_version)
    encoder = GraphSAGEEncoder(in_channels=FEATURE_DIM, hidden_channels=HIDDEN_DIM, out_channels=HIDDEN_DIM)
    predictor = LinkPredictor()

    encoder.load_state_dict(torch.load(os.path.join(version_dir, "encoder.pt")))
    predictor.load_state_dict(torch.load(os.path.join(version_dir, "predictor.pt")))
    encoder.eval()
    predictor.eval()

    return encoder, predictor, model_version