import torch
import torch.nn.functional as F
from torch_geometric.nn import SAGEConv


class GraphSAGEEncoder(torch.nn.Module):
    """
    Two-layer GraphSAGE — inductive by design (unlike M3's Node2Vec), so
    this same trained model can embed patients/events it never saw during
    training. That inductive property is the whole reason M4 uses a GNN
    instead of repeating M3's transductive approach.
    """

    def __init__(self, in_channels: int, hidden_channels: int = 32, out_channels: int = 32):
        super().__init__()
        self.conv1 = SAGEConv(in_channels, hidden_channels)
        self.conv2 = SAGEConv(hidden_channels, out_channels)

    def forward(self, x: torch.Tensor, edge_index: torch.Tensor) -> torch.Tensor:
        x = self.conv1(x, edge_index)
        x = F.relu(x)
        x = self.conv2(x, edge_index)
        return x


class LinkPredictor(torch.nn.Module):
    """
    Dot-product decoder: given two node embeddings, scores how likely they
    are to be connected. This score is exactly what becomes a
    PatternCandidate's `confidence` in M4.4 — trained here, reused there.
    """

    def forward(self, z: torch.Tensor, edge_index: torch.Tensor) -> torch.Tensor:
        src, dst = edge_index
        return (z[src] * z[dst]).sum(dim=-1)