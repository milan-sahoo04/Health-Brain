from pydantic import BaseModel
from typing import Optional

class GraphNode(BaseModel):
    id: str
    labels: list[str]
    type: Optional[str] = None
    date: Optional[str] = None
    embedding: Optional[list[float]] = None  # from M3; None until M4.5 wires the real export

class GraphEdge(BaseModel):
    source: str
    target: str
    relType: str

class FeatureRequest(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]

class FeatureResponse(BaseModel):
    node_ids: list[str]           # row order — same order as node_features
    node_features: list[list[float]]
    edge_index: list[list[int]]    # [2, E] — source/target indices into node_ids
    edge_features: list[list[float]]
    feature_dim: int
    warnings: list[str]

# --- append to existing models.py ---

class PatientGraphInput(BaseModel):
    patientId: str
    nodes: list[GraphNode]
    edges: list[GraphEdge]

class TrainRequest(BaseModel):
    patients: list[PatientGraphInput]
    epochs: int = 100

class TrainResponse(BaseModel):
    modelVersion: str
    datasetVersion: str
    trainedAt: str
    epochs: int
    finalLoss: float
    numNodes: int
    numEdges: int
    numPatients: int

# --- append to existing models.py ---

class PatientGraphInput2(BaseModel):
    """Separate from PatientGraphInput used by /train — /infer takes ONE
    patient, not a batch."""
    patientId: str
    nodes: list[GraphNode]
    edges: list[GraphEdge]

class InferRequest(BaseModel):
    patient: PatientGraphInput2

class CandidatePrediction(BaseModel):
    sourceNodeId: str
    targetNodeId: str
    relation: str
    confidence: float
    supportingNodes: list[str]
    supportingEdges: list[dict]  # [{source, target, relType}]
    explanation: str

class InferResponse(BaseModel):
    patientId: str
    modelVersion: str
    graphVersion: str
    candidates: list[CandidatePrediction]
    totalPairsScored: int
    latencyMs: float