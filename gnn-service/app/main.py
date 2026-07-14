from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException
from .models import (
    FeatureRequest, FeatureResponse, TrainRequest, TrainResponse,
    InferRequest, InferResponse, CandidatePrediction,
)
from .features import build_features
from .dataset import build_combined_graph
from .training import train_model
from .inference import run_inference
from .model_registry import ModelNotFoundError

app = FastAPI(title="PHB GNN Pattern Discovery Service")

@app.get("/health")
def health():
    return {"status": "ok", "service": "gnn-service"}

@app.post("/features/build", response_model=FeatureResponse)
def features_build(req: FeatureRequest):
    if not req.nodes:
        raise HTTPException(status_code=400, detail="nodes list is empty")
    node_ids, node_features, edge_index, edge_features, feature_dim, warnings = build_features(
        req.nodes, req.edges
    )
    return FeatureResponse(
        node_ids=node_ids, node_features=node_features, edge_index=edge_index,
        edge_features=edge_features, feature_dim=feature_dim, warnings=warnings,
    )

@app.post("/train", response_model=TrainResponse)
def train(req: TrainRequest):
    if not req.patients:
        raise HTTPException(status_code=400, detail="patients list is empty")
    patient_graphs = [(p.nodes, p.edges) for p in req.patients]
    x, edge_index, node_ids = build_combined_graph(patient_graphs)
    if x.size(0) == 0:
        raise HTTPException(status_code=400, detail="Combined graph has no nodes")
    metadata = train_model(x, edge_index, epochs=req.epochs, dataset_version=f"aura-batch-{len(req.patients)}patients")
    return TrainResponse(**metadata, numPatients=len(req.patients))

@app.post("/infer", response_model=InferResponse)
def infer(req: InferRequest):
    """
    Runs the currently-trained model over ONE patient's subgraph.
    Internal endpoint — called only by backend/src/services/gnnInferenceClient.ts.
    """
    if not req.patient.nodes:
        raise HTTPException(status_code=400, detail="patient has no nodes")

    try:
        candidates, model_version, total_pairs, latency_ms = run_inference(
            req.patient.nodes, req.patient.edges
        )
    except ModelNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e))

    return InferResponse(
        patientId=req.patient.patientId,
        modelVersion=model_version,
        graphVersion=datetime.now(timezone.utc).isoformat(),
        candidates=[CandidatePrediction(**c) for c in candidates],
        totalPairsScored=total_pairs,
        latencyMs=latency_ms,
    )