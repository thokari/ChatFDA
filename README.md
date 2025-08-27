# ChatFDA

**ChatFDA** is an open-source project aiming to provide a simple chat interface for querying FDA drug label data. The goal is to help users ask questions about drug usage, risks, and other safety information for a curated selection of medications.  
**Note:** This project is focused on FDA-approved pharmaceuticals and does **not** cover recreational or illicit drugs.

---

## What is the FDA?

The **U.S. Food and Drug Administration (FDA)** is a government agency responsible for protecting public health by ensuring the safety, efficacy, and security of drugs, biological products, and medical devices.  
This project uses publicly available FDA drug label data to help users better understand medication usage and risks.

---

## Project Status

- **Backend setup**: OpenSearch (for search/indexing) and supporting scripts are ready.
- **Data ingestion**: Not yet run—no drug data is indexed by default.
- **Frontend**: Not implemented yet.
- **.env file**: Required for secrets and configuration (see below).

---

## Installation & Setup

### 1. Clone the repository

```sh
git clone https://github.com/yourusername/ChatFDA.git
cd ChatFDA
```

### 2. Prerequisites

- [Docker](https://www.docker.com/) (for OpenSearch)
- [Node.js 20+](https://nodejs.org/)
- [pnpm](https://pnpm.io/) or [npm](https://www.npmjs.com/) (for JS dependencies)

### 3. Environment Variables

Create a `.env` file in the project root with the following content:

```env
OS_PASS="58#n#xB*sE8pZUom"
OPENAI_API_KEY=<your-openai-api-key>
```

- `OS_PASS` is the OpenSearch admin password (provided for development).
- `OPENAI_API_KEY` is your [OpenAI API key](https://platform.openai.com/account/api-keys).

### 4. Start OpenSearch

From the `_dev` directory, run:

```sh
docker compose up -d
```

This will start OpenSearch and OpenSearch Dashboards on your machine.

### 5. Install Dependencies

```sh
cd src/javascript
pnpm install
# or
npm install
```

### 6. (Optional) Run Checks and Ingestion

Ensure you have a .env in the repo root with OPENAI_API_KEY=... (the CLI loads the root .env regardless of where you run it from).

Go to the JS root:
```sh
cd src/javascript
```

- Check availability on openFDA (no indexing yet):
```sh
node --loader ts-node/esm lib/job/cli.ts check --ingredient naproxen --route ORAL
```

- Start ingestion (fetch → index labels → chunk → embed → index chunks):
```sh
node --loader ts-node/esm lib/job/cli.ts start --ingredient naproxen --route ORAL --limit 100
```

Other substance examples with rich labels (use ORAL unless noted):
- IBUPROFEN
- ACETAMINOPHEN
- AMOXICILLIN
- METFORMIN
- ATORVASTATIN
- CLOZAPINE
- ISOTRETINOIN
- AMIODARONE

Example:
```sh
node --loader ts-node/esm lib/job/cli.ts check --ingredient clozapine --route ORAL
node --loader ts-node/esm lib/job/cli.ts start --ingredient clozapine --route ORAL --limit 100
```

Monitor in OpenSearch Dashboards (Discover/Dev Tools) using indices:
- ingest-jobs, ingest-events, drug-labels, drug-chunks
---

## Roadmap

- [x] Backend setup (OpenSearch, scripts)
- [x] Data ingestion and indexing
- [ ] Chat frontend (web interface)
- [ ] Natural language Q&A over drug data

---

## Disclaimer

This project is for educational and informational purposes only.  
It is **not** a substitute for professional medical advice.  
All data is sourced from the FDA and refers to approved pharmaceuticals, not recreational or illicit substances.

---

## License

ISC License

---

## Contributing

Contributions are welcome! Please open issues or pull requests as you see fit.
