# AI Team Memory — Full Product Specification

## Product Definition

AI Team Memory is a continuously updating engineering intelligence system that automatically converts engineering activity into structured institutional memory.

The system ingests:

* GitHub/GitLab activity
* Pull requests
* Jira tickets
* Slack discussions
* Incidents
* CI/CD events
* ADRs
* Documentation
* Service metadata

It transforms them into:

* a queryable knowledge graph
* semantic memory embeddings
* ownership intelligence
* architectural history
* incident-linked engineering context

The system answers:

* who owns a system
* why architectural decisions were made
* what broke previously
* what systems depend on each other
* how incidents evolved
* where institutional knowledge exists

without relying on manual documentation maintenance.

The platform is designed for:

* engineering organizations with 50–5000 engineers
* microservice environments
* distributed teams
* rapidly evolving architectures
* high onboarding cost environments

---

# Core Product Capabilities

## 1. Ownership Intelligence

Tracks:

* service ownership
* module ownership
* reviewer ownership
* historical ownership
* orphaned services
* knowledge concentration

Queries:

* “Who owns checkout-service?”
* “Who reviewed most auth PRs?”
* “Who understands payment retries?”

Outputs:

* direct owners
* historical contributors
* confidence score
* related services

---

## 2. Architectural Decision Memory

Captures:

* ADRs
* Slack architecture discussions
* PR design decisions
* RFCs
* Jira architectural tickets

Links:

* decisions → services
* decisions → incidents
* decisions → PRs

Queries:

* “Why did we choose Kafka?”
* “Why was Redis removed?”
* “What alternatives were considered?”

---

## 3. Incident Memory

Stores:

* incidents
* root causes
* affected services
* mitigation steps
* postmortems
* timelines

Queries:

* “Have we seen this before?”
* “What incidents affected payments?”
* “What usually breaks after auth deploys?”

---

## 4. Dependency Intelligence

Builds:

* service dependency graph
* deployment propagation graph
* runtime relationship graph

Tracks:

* upstream/downstream dependencies
* cascading risk paths
* frequently co-changing systems

Queries:

* “What breaks if checkout changes?”
* “Which services depend on auth?”

---

## 5. Engineering Search

Semantic search across:

* PRs
* incidents
* Slack threads
* ADRs
* documentation
* commit discussions

Supports:

* hybrid search
* vector similarity
* graph traversal
* contextual summarization

---

# High-Level System Architecture

```text
                +----------------------+
                | External Sources     |
                |----------------------|
                | GitHub / GitLab      |
                | Slack                |
                | Jira                 |
                | PagerDuty            |
                | Confluence / Notion  |
                | CI/CD                |
                +----------+-----------+
                           |
                           v
                +----------------------+
                | Ingestion Gateway    |
                |----------------------|
                | Webhooks             |
                | Pollers              |
                | Rate Limiting        |
                | Validation           |
                +----------+-----------+
                           |
                           v
                +----------------------+
                | Event Bus (Kafka)    |
                +----------+-----------+
                           |
        +------------------+------------------+
        |                                     |
        v                                     v
+-------------------+          +-------------------------+
| Stream Processor  |          | NLP / Embedding Workers |
|-------------------|          |-------------------------|
| Entity extraction |          | Embeddings              |
| Relationship link |          | Semantic chunking       |
| Event enrichment  |          | Classification          |
+---------+---------+          +------------+------------+
          |                                 |
          v                                 v
+-------------------+          +-------------------------+
| Graph DB          |          | Vector DB               |
| Neo4j             |          | Pinecone / Weaviate     |
+---------+---------+          +------------+------------+
          |                                 |
          +---------------+-----------------+
                          |
                          v
                +----------------------+
                | Query Engine         |
                |----------------------|
                | Graph traversal      |
                | Semantic retrieval   |
                | Reranking            |
                | Context synthesis    |
                +----------+-----------+
                           |
                           v
                +----------------------+
                | API Layer            |
                |----------------------|
                | REST/gRPC            |
                | Slack Bot            |
                | IDE Extension        |
                | Dashboard            |
                +----------------------+
```

---

# Core Data Model

## Entities

### Service

```json
{
  "id": "service-payment",
  "name": "payment-service",
  "repo": "github.com/acme/payment",
  "language": "go",
  "created_at": "2025-01-01T00:00:00Z"
}
```

---

### Person

```json
{
  "id": "person-alice",
  "email": "alice@company.com",
  "team": "payments",
  "joined_at": "2024-03-01"
}
```

---

### Decision

```json
{
  "id": "decision-kafka-choice",
  "title": "Kafka selected over RabbitMQ",
  "context": "Need ordered replayable events",
  "decision": "Use Kafka",
  "alternatives": [
    "RabbitMQ",
    "NATS"
  ],
  "consequences": [
    "Higher operational complexity"
  ]
}
```

---

### Incident

```json
{
  "id": "incident-payment-timeout",
  "severity": "P1",
  "start_time": "2025-02-01T12:00:00Z",
  "root_cause": "Timeout retry loop"
}
```

---

# Relationship Graph

```text
Person ── OWNS ──► Service
Decision ── AFFECTS ──► Service
Incident ── IMPACTS ──► Service
PR ── IMPLEMENTS ──► Decision
Service ── DEPENDS_ON ──► Service
Incident ── CAUSED_BY ──► PR
```

---

# Ingestion Pipeline

## Sources

### GitHub/GitLab

Ingest:

* commits
* PRs
* reviews
* comments
* CODEOWNERS
* branch events

### Slack

Ingest:

* architecture channels
* incident channels
* threaded discussions

### Jira

Ingest:

* tickets
* epics
* comments
* sprint data

### PagerDuty

Ingest:

* incidents
* escalations
* on-call timelines

### CI/CD

Ingest:

* deploy events
* failures
* test results

---

# Event Pipeline

## Canonical Event Schema

```json
{
  "event_id": "uuid",
  "tenant_id": "acme",
  "event_type": "github.pr.opened",
  "timestamp": "2025-02-01T10:00:00Z",
  "payload": {},
  "metadata": {}
}
```

---

# Processing Pipeline

## Step 1 — Normalize

Convert all source events into canonical schema.

---

## Step 2 — Entity Extraction

Extract:

* services
* modules
* people
* incidents
* decisions

via:

* heuristics
* regex
* embeddings
* LLM classification

---

## Step 3 — Relationship Linking

Examples:

* PR references Jira ticket
* Incident references deploy
* Slack thread references service

---

## Step 4 — Graph Persistence

Store:

* nodes
* edges
* timestamps
* provenance
* confidence scores

---

## Step 5 — Embedding Generation

Generate embeddings for:

* ADRs
* Slack discussions
* PR descriptions
* incidents
* docs

Chunking:

* 512 tokens
* 128 overlap

---

# Query System

## Query Types

### Ownership Queries

“Who owns checkout-service?”

### Historical Queries

“Why was Kafka chosen?”

### Incident Queries

“What broke payment last quarter?”

### Dependency Queries

“What depends on auth-service?”

### Contextual Queries

“What should I know before changing billing?”

---

# Retrieval Pipeline

```text
User Query
    ↓
Intent Classification
    ↓
Graph Query + Vector Search
    ↓
Result Fusion
    ↓
Cross-Encoder Reranking
    ↓
LLM Context Synthesis
    ↓
Answer + Citations
```

---

# AI Components

## Embeddings

Use:

* text-embedding-3-large
* Voyage embeddings

---

## Reranking

Cross-encoder reranker:

* bge-reranker-large
* Cohere rerank

---

## LLM Tasks

Used only for:

* summarization
* entity classification
* relationship extraction
* answer synthesis

NOT for:

* primary storage
* source-of-truth logic

---

# Memory Aging & Versioning

## Required

Without this the system becomes corrupted over time.

Track:

* superseded decisions
* historical ownership
* deprecated services
* renamed services

---

# Relevance Decay

```python
relevance = base_score * exp(-days / decay_constant)
```

---

# Critical Production Requirements

## 1. Tenant Isolation

Strict separation at:

* graph layer
* vector layer
* ingestion layer
* cache layer

No shared embeddings between tenants.

---

## 2. Provenance

Every answer must show:

* source documents
* timestamps
* original systems
* confidence

---

## 3. Conflict Resolution

Example:

* Slack says Team A owns service
* CODEOWNERS says Team B

Need:

* confidence scoring
* precedence rules
* timestamps

---

## 4. Entity Resolution

Must unify:

* “payment”
* “payment-service”
* “payments-api”

into one canonical entity.

---

# Tech Stack

## Backend

Go

## NLP Workers

Python

## Graph DB

Neo4j

## Vector DB

Pinecone or Weaviate

## Streaming

Kafka

## Stream Processing

Flink

## Metadata Store

Postgres

## Blob Storage

S3

## Frontend

React + TypeScript

## Infra

Kubernetes

---

# MVP (Realistic)

DO NOT build the full architecture first.

## MVP Scope

### Include

* GitHub ingestion
* PR ingestion
* ownership graph
* vector search
* Slack bot
* simple dashboard

### Exclude

* incidents
* Jira
* advanced ML
* dependency inference
* causal graphs

---

# MVP Architecture

```text
GitHub Webhook
      ↓
Ingestion API
      ↓
Postgres
      ↓
Embedding Worker
      ↓
Neo4j + Pinecone
      ↓
Memory API
      ↓
Slack Bot / Dashboard
```

---

# Real Product Differentiator

The product is NOT:

* another wiki
* another search engine
* another chatbot

The differentiator is:

## “Automatic institutional memory generation from engineering behavior.”

That is the actual product.

Everything else is infrastructure.
