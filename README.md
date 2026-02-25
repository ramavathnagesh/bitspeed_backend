# Bitespeed Identity Reconciliation Service

This web service provides an `/identify` endpoint to reconcile customer contact information. As a customer places multiple orders using various permutations of email addresses and phone numbers, this service identifies connected contact identities and resolves them into unified clusters.

## 🚀 Setup & Execution

### Prerequisites

- Node.js (v18+)

### Installation

```bash
npm install
```

### Database Initialization

This project uses **SQLite** through **Prisma ORM** for zero-friction local development.

```bash
npx prisma db push
```

### Starting the Server

Start the development server with live-reloading:

```bash
npm run dev
```

### Seed Data

To populate the database with a test matrix:

```bash
npm run seed
```

### Running Tests

This project includes extensive integration edge-case tests utilizing Jest & Supertest.

```bash
npm run test
```

---

## 🏗️ Architecture

Identity reconciliation is treated fundamentally as a **Graph Problem**, where contact rows represent nodes, and matching fields (email or phone) form edges. The graph algorithm connects related subsets of contacts into unified components (Clusters).

The dominant read operations of this system rely on exact matching constraints. As such, the underlying schema uses `@@index` on `email`, `phoneNumber`, and `linkedId` to ensure logarithmic-time indexed lookups even as data volume scales.

### Validation Strategy

- At least one of `email` or `phoneNumber` must be present.
- `email` is normalized to lowercase and trimmed.
- `phoneNumber` is stringified for consistency and trimmed.

### System Workflow

The `/identify` reconciliation logic is wrapped inside an **isolated database transaction** (`prisma.$transaction`) to prevent dirty reads or data races where concurrent requests could attempt overlapping cluster merges.

**The Algorithm Flow:**

1. **Initial Edge Resolution**: Incoming payload queries the database to find any nodes sharing the same email OR phone number.
2. **Root Primary Tracing**: For any subset of clusters discovered in Step 1, the algorithm recursively walks up the `linkedId` edge to discover the "Root Primary" identity associated with each subset.
3. **Full Cluster Fetching**: Complete cluster components are fetched corresponding to the isolated root primary nodes.
4. **Merge Matrix (Component Union)**:
   - If multiple disparate Primaries are resolved, the system executes a multi-primary merge.
   - The Primaries are chronologically sorted (`createdAt`).
   - The oldest retains `Primary` status. All newer Primaries are converted in-place to `Secondary` status, and their inbound relationships are remapped to point directly at the surviving Old Primary.
   - **Re-fetch Step**: After merge operations, the cluster is actively re-fetched to guarantee consistency and capture updated state constraints before constructing the final response.
   - **Bridging Edge Case**: Special care is handled internally when an inbound request contains an email matching one distinct cluster, and a phone matching another distinct cluster. This triggers a component union operation where both disparate clusters are successfully merged under the single oldest root primary.
5. **Exact Duplicate Strategy**: If the requested identity combination is already satisfied by an existing node in the cluster, the process terminates harmlessly (Idempotency check).
6. **Secondary Creation**: If the request surfaces _new_ information not tracked anywhere else in the resolved cluster, a new `Secondary` node is inserted.
7. **Consolidation**: A consolidated JSON overview is constructed. Data elements are de-duplicated using `Set` implementations, with structural precedence given to the root node.

---
