"""Dev/validation entrypoint — trains on synthetic data only. Not used in
production; production training goes through POST /train with real data."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.dataset import build_synthetic_dataset
from app.training import train_model

if __name__ == "__main__":
    x, edge_index, node_ids = build_synthetic_dataset(num_patients=20)
    print(f"Training graph: {x.shape[0]} nodes, {edge_index.shape[1]} edges")
    metadata = train_model(x, edge_index, epochs=100, dataset_version="synthetic-poc-v1")
    print(f"\nSaved model: {metadata['modelVersion']}")
    print(f"Final loss: {metadata['finalLoss']:.4f}")