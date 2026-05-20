# Legal Document AI Suite

An enterprise-grade platform for legal document analysis, topic extraction, and hierarchical taxonomy generation powered by Mistral AI.

## Features
- **Intelligent Topic Extraction**: Automatically identifies key legal concepts from PDF documents.
- **Dynamic Taxonomy (Mindmap)**: Semantic grouping of topics into hierarchical concept trees via Mistral AI.
- **Topic Dictionary**: Comprehensive database of all extracted terms across the entire document library.
- **Real-time Processing**: Django-based processing with immediate status updates.
- **Secure Handling**: Local document management and private API integration.

## Project Structure
- **/client**: React frontend (Vite, Tailwind, Shadcn UI).
- **/core**: Django app containing the business logic and AI integration.
- **/legal_backend**: Main Django configuration and entry point.
- **/media**: Location for uploaded documents and OCR text files.
- **/config3.py**: Configuration file for API keys and AI prompts.

## Quick Start (Local Setup)

### Prerequisites
- Python 3.10+
- Node.js 18+
- Mistral AI API Key

### Backend Setup
1. Create a virtual environment: `python -m venv venv`
2. Activate venv: `.\venv\Scripts\activate` (Windows)
3. Install dependencies: `pip install -r requirements.txt`
4. Run migrations: `python manage.py migrate`
5. Configure `config3.py` with your Mistral API Key.

### Frontend Setup
1. Navigate to client: `cd client`
2. Install dependencies: `npm install`
3. Start development server: `npm run dev`

### Easy Launch
If you are on Windows and have both `venv` and `node_modules` prepared, simply run:
```bash
./run.bat
```

## Credential Note
Ensure your Mistral API Key is placed in `config3.py` before running. Access the dashboard at `http://localhost:5000/`.
