# ChatFDA

**ChatFDA** is a chat interface for querying FDA drug label data. It answers users questions about drug usage, risks, and other safety information for a curated selection of medications.

The purpose of this project is quickly prototyping a simple RAG application on complex data, exploring technologies (OpenSearch, langchain.js, Next.js and Vercel) and different approaches to prompt engineering, searching, filtering, and quoting.

## What is the FDA?

The **U.S. Food and Drug Administration (FDA)** is a government agency responsible for protecting public health by ensuring the safety, efficacy, and security of drugs, biological products, and medical devices.
This project uses publicly available FDA drug label data from https://api.fda.gov/drug/label.json.

**Note:** This project targets FDA‑approved pharmaceuticals, not recreational/illicit drugs.

## Architecture overview
### Data layer
OpenSearch indices exist for:
- ingestion jobs and event
- drug labels and their chunks (text segments)
- metrics
### Backend
There is single Next.js app which contains
- scripts for data ingestion
- test scripts for retrieval and answering
- API routes for query and (streaming) response
### Frontend
There are couple of React components that implement chat and citation cards.
State (chat messages) is maintained via zustand.

## Quick start

1) Prereqs
- Docker (for OpenSearch + Dashboards)
- Node.js 20+

2) Boot OpenSearch
- From `./_dev` run: `docker compose up -d`

3) Env variables
- `OS_PASS=58#n#xB*sE8pZUom`
- `OS_INSECURE_TLS=1`
- `OPENAI_API_KEY=...`

4) Install JS deps
- `cd javascript`
- `npm install`

5) Dev server
- `npm run dev` then open http://localhost:3000

6) Tests
- `npm run test`
- `npm run test:watch`

## Using npm scripts with parameters

All scripts in `javascript/package.json` accept extra flags after `--` and forward them to the underlying TS commands.

Examples (run inside `javascript`):

- Ask once
	- `npm run ask -- --q "pregnancy safe pain reliever" --topK 3`

- Retrieve only
	- `npm run retrieve -- --q "ibuprofen pregnancy" --topK 12`

- Scan label fields
	- `npm run scan:fields`

- Ingestion CLI
	- Check availability
		- `npm run ingest -- check --ingredient clozapine --route ORAL`
	- Start ingestion
		- `npm run ingest -- start --ingredient clozapine --route ORAL --limit 100`
	- Start batch from CSV (repo path: `seeds/`)
		- `npm run ingest -- start-batch --file ../seeds/drug-seeds-10.csv --limit 100 --updatedSince 20240101 -v`

## OpenSearch dashboards

Indices used during dev: `ingest-jobs`, `ingest-events`, `drug-labels`, `drug-chunks`, `ask-metrics`.

Open Dashboards (default dev user/pass: admin / OS_PASS) and explore Discover/Dev Tools.

## Roadmap

- [ ] End-to-end tests against selector to check data quality  
- [x] Frontend: feedback on request phase/runtime  
- [ ] Data analysis: increase topK, prefilter before LLM steps (shingles?)  
- [ ] Data analysis: try different search algorithms (BM25 on chunks)  
- [ ] Unit test or library use for MMR algorithm  
- [ ] Gold data collection via the UI  
- [ ] Frontend: AI supported extended search  
- [ ] Deploy OpenSearch on AWS, configure auth  
- [ ] Deploy frontend on Vercel, connect OpenSearch  

## License

ISC
